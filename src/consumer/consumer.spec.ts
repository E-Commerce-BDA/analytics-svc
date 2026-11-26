import { describe, expect, it, vi } from 'vitest';
import type { KafkaContext } from '@nestjs/microservices';
import type { Connection } from 'mongoose';
import { ConsumerMetrics, KafkaDlqPublisher, type RelayLogger } from '@ecom/messaging';
import { AnalyticsConsumerController } from './analytics-consumer.controller.js';
import { CONSUMER_GROUP_ID } from './consumer-runtime.js';
import { AnalyticsFactStore } from './fact-store.js';
import { AnalyticsEventHandler } from './handlers.js';
import { createAnalyticsEventHandler } from './events.module.js';

const EVENT_ID = '0190a8b0-0000-7000-8000-000000000a01';
const USER_ID = '0190a8b0-0000-7000-8000-000000000a02';
const NOW = '2026-11-24T10:00:00.000Z';

const envelope = (type: string, payload: Record<string, unknown>) => ({
  id: EVENT_ID,
  type,
  version: 1,
  producer: 'test',
  timestamp: NOW,
  idempotencyKey: EVENT_ID,
  payload,
});

const payloads = {
  'page.viewed': { sessionId: 's-1', page: '/shoes', eventKind: 'pageview', timestamp: NOW },
  'cart.updated': {
    cartId: USER_ID,
    userId: USER_ID,
    sessionId: 's-1',
    status: 'active',
    items: [],
    totals: { subtotal: 10, itemCount: 1, lineCount: 1 },
    updatedAt: NOW,
  },
  'order.created': {
    orderId: USER_ID,
    orderNumber: 'ORD-1',
    userId: USER_ID,
    grandTotal: 10,
    itemsCount: 1,
    reservationId: '',
    createdAt: NOW,
  },
  'user.registered': { userId: USER_ID, registeredAt: NOW },
};

const silentLogger: RelayLogger = {
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

describe('AnalyticsFactStore (Mongo)', () => {
  const setup = () => {
    const processedInsert = vi.fn(async () => ({}));
    const factInsert = vi.fn(async () => ({}));
    const db = {
      collection: (name: string) =>
        name === 'processed_events'
          ? { insertOne: processedInsert }
          : { insertOne: factInsert },
    };
    const session = { id: 's', abortTransaction: vi.fn(async () => undefined) };
    const tx = { run: vi.fn(async (fn: (s: unknown) => Promise<boolean>) => fn(session)) };
    const store = new AnalyticsFactStore(
      tx as never,
      { db } as unknown as Connection,
    );
    return { store, tx, session, processedInsert, factInsert, db };
  };

  it('claims the event and writes the fact in one transaction', async () => {
    const s = setup();
    expect(await s.store.record(EVENT_ID, 'cart.updated', 'cart_events', { cartId: 'c' })).toBe(true);
    expect(s.tx.run).toHaveBeenCalledTimes(1);
    expect(s.processedInsert).toHaveBeenCalledWith(
      expect.objectContaining({ _id: EVENT_ID, eventId: EVENT_ID, topic: 'cart.updated' }),
      expect.objectContaining({ session: expect.objectContaining({ id: 's' }) }),
    );
    expect(s.factInsert).toHaveBeenCalledWith(
      { cartId: 'c' },
      expect.objectContaining({ session: expect.objectContaining({ id: 's' }) }),
    );
    expect(s.session.abortTransaction).not.toHaveBeenCalled();
  });

  it('aborts the poisoned transaction on a duplicate key so it is not retried', async () => {
    const s = setup();
    s.processedInsert.mockRejectedValueOnce({ code: 11000 });
    expect(await s.store.record(EVENT_ID, 'page.viewed', 'page_views', {})).toBe(false);
    expect(s.session.abortTransaction).toHaveBeenCalledTimes(1);
    expect(s.factInsert).not.toHaveBeenCalled();
  });

  it('propagates any other Mongo error so the record is retried', async () => {
    const s = setup();
    s.processedInsert.mockRejectedValueOnce(new Error('primary down'));
    await expect(s.store.record(EVENT_ID, 'page.viewed', 'page_views', {})).rejects.toThrow('primary down');
    expect(s.session.abortTransaction).not.toHaveBeenCalled();
  });
});

describe('AnalyticsEventHandler', () => {
  const setup = () => {
    const record = vi.fn(
      async (
        _eventId: string,
        _topic: string,
        _collection: string,
        _fact: Record<string, unknown>,
      ) => true,
    );
    return { record, handler: new AnalyticsEventHandler({ record } as never) };
  };

  it.each([
    ['page.viewed', 'page_views'],
    ['cart.updated', 'cart_events'],
    ['order.created', 'order_events'],
    ['user.registered', 'user_events'],
  ] as const)('writes a %s fact to %s', async (topic, collection) => {
    const s = setup();
    const outcome = await s.handler.handle(envelope(topic, payloads[topic]));
    expect(outcome).toEqual({ kind: 'applied' });
    expect(s.record).toHaveBeenCalledWith(EVENT_ID, topic, collection, expect.any(Object));
  });

  it('does not copy a display name into the user fact', async () => {
    const s = setup();
    await s.handler.handle(
      envelope('user.registered', { ...payloads['user.registered'], displayName: 'Ada' }),
    );
    expect(s.record.mock.calls[0]![3]).toEqual({ userId: USER_ID, createdAt: NOW });
  });

  it('returns duplicate when the claim loses the race', async () => {
    const s = setup();
    s.record.mockResolvedValueOnce(false);
    expect(await s.handler.handle(envelope('order.created', payloads['order.created']))).toEqual({
      kind: 'duplicate',
      eventId: EVENT_ID,
    });
  });

  it('dead-letters a bad payload on the first attempt without writing a fact', async () => {
    const s = setup();
    const outcome = await s.handler.handle(envelope('cart.updated', { cartId: 'not-a-uuid' }));
    expect(outcome).toEqual(expect.objectContaining({ kind: 'invalid', stage: 'payload' }));
    expect(s.record).not.toHaveBeenCalled();
  });

  it('commits an event type it does not subscribe to', async () => {
    const s = setup();
    const outcome = await s.handler.handle(envelope('cms.updated', {}));
    expect(outcome).toEqual(expect.objectContaining({ kind: 'ignored' }));
    expect(s.record).not.toHaveBeenCalled();
  });

  // 2.0.0 made the canonical fields required and dropped the aliases. A stored
  // 1.x envelope must be rejected here, not silently normalised, so the backfill
  // is the only place a legacy shape is ever converted.
  const legacyShapes: ReadonlyArray<
    readonly [string, (raw: Record<string, unknown>) => Record<string, unknown>]
  > = [
    ['a topic alias', (raw) => ({ ...raw, topic: 'page.viewed' })],
    ['an eventType alias', (raw) => ({ ...raw, eventType: 'page.viewed' })],
    [
      'a missing version',
      (raw) => {
        delete raw.version;
        return raw;
      },
    ],
    [
      'a missing idempotencyKey',
      (raw) => {
        delete raw.idempotencyKey;
        return raw;
      },
    ],
  ];

  it.each(legacyShapes)('rejects %s at the envelope stage', async (_label, mutate) => {
    const s = setup();
    const raw = mutate({ ...envelope('page.viewed', payloads['page.viewed']) });
    const outcome = await s.handler.handle(raw);
    expect(outcome).toEqual(expect.objectContaining({ kind: 'invalid', stage: 'envelope' }));
    expect(s.record).not.toHaveBeenCalled();
  });
});

describe('analytics consumer protocol', () => {
  it('runs on one group named exactly analytics-svc', () => {
    expect(CONSUMER_GROUP_ID).toBe('analytics-svc');
  });

  it('bounds the ladder to four sleeps inside the 45s session', async () => {
    const sleeps: number[] = [];
    const order: string[] = [];
    const commitOffsets = vi.fn().mockImplementation(() => {
      order.push('commit');
      return Promise.resolve();
    });
    const send = vi.fn().mockImplementation(() => {
      order.push('dlq');
      return Promise.resolve({});
    });
    const dlq = new KafkaDlqPublisher({
      brokers: ['localhost:9092'],
      clientId: 'test-dlq',
      producer: {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        send,
      } as never,
      clock: () => new Date(NOW),
    });
    const handler = createAnalyticsEventHandler(dlq, new ConsumerMetrics(), {
      logger: silentLogger,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        order.push('sleep');
      },
    });
    const failing = { handle: vi.fn().mockRejectedValue(new Error('database down')) };
    const controller = new AnalyticsConsumerController(handler, failing as never);
    const ctx = {
      getMessage: () => ({ offset: '10', key: null }),
      getPartition: () => 0,
      getConsumer: () => ({ commitOffsets }),
    } as unknown as KafkaContext;

    await controller.onPageViewed(JSON.stringify(envelope('page.viewed', payloads['page.viewed'])), ctx);

    expect(sleeps).toEqual([1000, 2000, 4000, 8000]);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBe(15_000);
    expect(failing.handle).toHaveBeenCalledTimes(5);
    expect(order).toEqual(['sleep', 'sleep', 'sleep', 'sleep', 'dlq', 'commit']);
    expect(commitOffsets).toHaveBeenCalledWith([
      { topic: 'page.viewed', partition: 0, offset: '11' },
    ]);
  });
});
