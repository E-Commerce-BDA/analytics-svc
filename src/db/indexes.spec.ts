import { describe, expect, it, vi } from 'vitest';
import { ANALYTICS_COLLECTIONS, ensureIndexes, type IndexDb } from './indexes.js';

describe('analytics Mongo schema', () => {
  it('declares all three collections with their documented indexes', () => {
    expect(ANALYTICS_COLLECTIONS.map((c) => c.name)).toEqual([
      'page_views',
      'cart_events',
      'processed_events',
    ]);
    const ttl = (name: string) =>
      ANALYTICS_COLLECTIONS.find((c) => c.name === name)?.indexes.find((i) =>
        i.name.startsWith('ttl_'),
      );
    expect(ttl('page_views')?.expireAfterSeconds).toBe(30 * 24 * 60 * 60);
    expect(ttl('cart_events')?.expireAfterSeconds).toBe(60 * 24 * 60 * 60);
    expect(ttl('processed_events')).toBeUndefined();
  });

  it('deduplicates events forever with a unique eventId index', () => {
    const processed = ANALYTICS_COLLECTIONS.find(
      (c) => c.name === 'processed_events',
    );
    expect(processed?.indexes).toEqual([
      { key: { eventId: 1 }, name: 'processed_event_id', unique: true },
    ]);
  });

  it('creates every declared collection on the given db', async () => {
    const createIndexes = vi.fn(async () => 'ok');
    const db: IndexDb = { collection: () => ({ createIndexes }) };
    await ensureIndexes(db);
    expect(createIndexes).toHaveBeenCalledTimes(3);
    const calls = createIndexes.mock.calls as unknown as Array<[unknown[]]>;
    expect(calls.map(([specs]) => specs.length)).toEqual([2, 2, 1]);
  });
});
