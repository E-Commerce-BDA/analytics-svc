import { describe, expect, it, vi } from 'vitest';
import {
  ANALYTICS_COLLECTIONS,
  ensureIndexes,
  isInvalidUniqueIdIndex,
  repairIndexes,
  type ExistingIndex,
  type IndexDb,
  type RepairableIndexDb,
} from './indexes.js';

describe('analytics Mongo schema', () => {
  it('declares all three collections with their documented indexes', () => {
    expect(ANALYTICS_COLLECTIONS.map((c) => c.name)).toEqual([
      'page_views',
      'cart_events',
      'order_events',
      'user_events',
      'abandonment_windows',
      'processed_events',
    ]);
    const ttl = (name: string) =>
      ANALYTICS_COLLECTIONS.find((c) => c.name === name)?.indexes.find((i) =>
        i.name.startsWith('ttl_'),
      );
    expect(ttl('page_views')?.expireAfterSeconds).toBe(30 * 24 * 60 * 60);
    expect(ttl('cart_events')?.expireAfterSeconds).toBe(60 * 24 * 60 * 60);
    expect(ttl('order_events')?.expireAfterSeconds).toBe(60 * 24 * 60 * 60);
    expect(ttl('user_events')?.expireAfterSeconds).toBe(60 * 24 * 60 * 60);
    expect(ttl('processed_events')).toBeUndefined();
    expect(ttl('abandonment_windows')).toBeUndefined();
  });

  it('deduplicates events forever with a unique eventId index', () => {
    const processed = ANALYTICS_COLLECTIONS.find(
      (c) => c.name === 'processed_events',
    );
    expect(processed?.indexes).toEqual([
      { key: { eventId: 1 }, name: 'processed_event_id', unique: true },
    ]);
  });

  it('does not declare unique on an _id index, which Mongo rejects with 197', () => {
    const windows = ANALYTICS_COLLECTIONS.find(
      (c) => c.name === 'abandonment_windows',
    );
    expect(windows?.indexes).toEqual([{ key: { _id: 1 }, name: 'abandonment_window_id' }]);
  });

  it('repairs a stored invalid _id unique index and leaves valid ones alone', async () => {
    const dropIndex = vi.fn(async () => 'ok');
    const createIndexes = vi.fn(async () => 'ok');
    const existing: ExistingIndex[] = [
      { name: '_id_', key: { _id: 1 }, unique: true },
      { name: 'abandonment_window_id', key: { _id: 1 }, unique: true },
      { name: 'processed_event_id', key: { eventId: 1 }, unique: true },
    ];
    const db: RepairableIndexDb = {
      collection: () => ({
        createIndexes,
        indexes: async () => existing,
        dropIndex,
      }),
    };
    expect(isInvalidUniqueIdIndex(existing[0]!)).toBe(false);
    expect(isInvalidUniqueIdIndex(existing[1]!)).toBe(true);
    expect(isInvalidUniqueIdIndex(existing[2]!)).toBe(false);
    expect(await repairIndexes(db)).toEqual(
      ANALYTICS_COLLECTIONS.map((c) => `${c.name}.abandonment_window_id`),
    );
    expect(dropIndex).toHaveBeenCalledTimes(6);
    expect(createIndexes).toHaveBeenCalledTimes(6);
  });

  it('creates every declared collection on the given db', async () => {
    const createIndexes = vi.fn(async () => 'ok');
    const db: IndexDb = { collection: () => ({ createIndexes }) };
    await ensureIndexes(db);
    expect(createIndexes).toHaveBeenCalledTimes(6);
    const calls = createIndexes.mock.calls as unknown as Array<[unknown[]]>;
    expect(calls.map(([specs]) => specs.length)).toEqual([2, 2, 2, 2, 1, 1]);
  });
});
