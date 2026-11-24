import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from 'mongoose';
import { AbandonmentWriter, type IdleCart } from './abandonment-writer.js';
import { CartAbandonmentScheduler } from './abandonment.scheduler.js';

const NOW = new Date('2026-11-24T12:00:00.000Z');
const CART_ID = '0190a8b0-0000-7000-8000-000000000b01';
const USER_ID = '0190a8b0-0000-7000-8000-000000000b02';

const idleCart: IdleCart = {
  cartId: CART_ID,
  userId: USER_ID,
  sessionId: 's-1',
  itemsCount: 2,
  subtotal: 49.5,
  lastActivityAt: new Date('2026-11-24T11:00:00.000Z'),
};

const latestRow = {
  _id: CART_ID,
  last: {
    cartId: CART_ID,
    userId: USER_ID,
    sessionId: 's-1',
    status: 'active',
    itemsCount: 2,
    totals: { subtotal: 49.5 },
    createdAt: idleCart.lastActivityAt.toISOString(),
  },
};

describe('AbandonmentWriter', () => {
  const setup = (rows: unknown[] = [latestRow]) => {
    const aggregate = vi.fn((_stages: Record<string, unknown>[]) => ({
      toArray: async () => rows,
    }));
    const markerInsert = vi.fn(async () => ({}));
    const db = {
      collection: (name: string) =>
        name === 'cart_events' ? { aggregate } : { insertOne: markerInsert },
    };
    const tx = { run: vi.fn(async (fn: (s: unknown) => Promise<boolean>) => fn({ id: 's' })) };
    const outbox = {
      recordCartAbandoned: vi.fn(
        async (
          _session: unknown,
          _write: { aggregateId: string; payload: unknown; occurredAt: Date },
        ) => 'evt',
      ),
    };
    const writer = new AbandonmentWriter(
      tx as never,
      outbox as never,
      { db } as unknown as Connection,
    );
    return { writer, aggregate, markerInsert, outbox, tx };
  };

  it('scans the latest fact per active cart and honours the cutoff and batch', async () => {
    const s = setup();
    const cutoff = new Date('2026-11-24T11:30:00.000Z');
    expect(await s.writer.scan(cutoff, 25)).toEqual([idleCart]);
    const stages = s.aggregate.mock.calls[0]![0] as Record<string, unknown>[];
    expect(stages[2]).toEqual({
      $match: {
        'last.status': 'active',
        'last.createdAt': { $lte: cutoff.toISOString() },
      },
    });
    expect(stages[3]).toEqual({ $limit: 25 });
  });

  it('writes the marker and the outbox row in one transaction', async () => {
    const s = setup();
    expect(await s.writer.publish(idleCart, NOW)).toBe(true);
    expect(s.tx.run).toHaveBeenCalledTimes(1);
    expect(s.markerInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: `${CART_ID}|${idleCart.lastActivityAt.toISOString()}`,
        cartId: CART_ID,
      }),
      expect.objectContaining({ session: { id: 's' } }),
    );
    expect(s.outbox.recordCartAbandoned).toHaveBeenCalledWith(
      { id: 's' },
      expect.objectContaining({
        aggregateId: USER_ID,
        payload: expect.objectContaining({
          cartId: CART_ID,
          lastActivityAt: idleCart.lastActivityAt.toISOString(),
          abandonedAt: NOW.toISOString(),
        }),
        occurredAt: NOW,
      }),
    );
  });

  it('treats a duplicate window as a no-op and never writes a second event', async () => {
    const s = setup();
    s.markerInsert.mockRejectedValueOnce({ code: 11000 });
    expect(await s.writer.publish(idleCart, NOW)).toBe(false);
    expect(s.outbox.recordCartAbandoned).not.toHaveBeenCalled();
  });

  it('keys a guest cart by session id, falling back to the cart id', async () => {
    const s = setup();
    await s.writer.publish({ ...idleCart, userId: null }, NOW);
    expect(s.outbox.recordCartAbandoned.mock.calls[0]![1]).toEqual(
      expect.objectContaining({ aggregateId: 's-1' }),
    );

    await s.writer.publish({ ...idleCart, userId: null, sessionId: null }, NOW);
    expect(s.outbox.recordCartAbandoned.mock.calls[1]![1]).toEqual(
      expect.objectContaining({ aggregateId: CART_ID }),
    );
  });

  it('propagates other Mongo errors so the sweep can be retried', async () => {
    const s = setup();
    s.markerInsert.mockRejectedValueOnce(new Error('primary down'));
    await expect(s.writer.publish(idleCart, NOW)).rejects.toThrow('primary down');
  });
});

describe('CartAbandonmentScheduler', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  const setup = (values: Record<string, unknown> = {}) => {
    const config = {
      get: vi.fn((key: string, fallback: unknown) =>
        key in values ? values[key] : fallback,
      ),
    };
    const writer = {
      scan: vi.fn(async () => [idleCart]),
      publish: vi.fn(async () => true),
    };
    const scheduler = new CartAbandonmentScheduler(config as never, writer as never);
    return { scheduler, config, writer };
  };

  it('uses the default 30 minute threshold and a 100-cart batch', async () => {
    const s = setup();
    expect(await s.scheduler.sweep(NOW)).toBe(1);
    expect(s.writer.scan).toHaveBeenCalledWith(
      new Date('2026-11-24T11:30:00.000Z'),
      100,
    );
  });

  it('honours a configured threshold and batch size', async () => {
    const s = setup({ CART_ABANDONED_AFTER_MS: 10 * 60_000, ABANDONMENT_SWEEP_BATCH_SIZE: 5 });
    await s.scheduler.sweep(NOW);
    expect(s.writer.scan).toHaveBeenCalledWith(
      new Date('2026-11-24T11:50:00.000Z'),
      5,
    );
  });

  it('counts only carts whose window was actually published', async () => {
    const s = setup();
    s.writer.publish.mockResolvedValueOnce(false);
    expect(await s.scheduler.sweep(NOW)).toBe(0);
  });

  it('does not run the background timer in tests', async () => {
    const s = setup();
    process.env.NODE_ENV = 'test';
    await s.scheduler.handleSweep();
    expect(s.writer.scan).not.toHaveBeenCalled();
  });

  it('honours ABANDONMENT_SWEEP_ENABLED=false outside tests', async () => {
    const s = setup({ ABANDONMENT_SWEEP_ENABLED: 'false' });
    process.env.NODE_ENV = 'development';
    await s.scheduler.handleSweep();
    expect(s.writer.scan).not.toHaveBeenCalled();
  });
});
