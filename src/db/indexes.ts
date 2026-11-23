/**
 * Mongo collection/index definitions for analytics (anl-001).
 *
 * Kept as pure data so a unit test can assert the TTL windows without a live
 * database. `ensureIndexes` is the only impure line: it asks Mongo to create
 * what the data already declares.
 *
 * Why TTL lives here: page views and cart events are append-only facts that
 * lose meaning after a month. `processed_events` deliberately has NO TTL —
 * dedupe must outlive the facts it protects, or a replay after 30 days would
 * double-count a view.
 */

export interface IndexDefinition {
  readonly key: Record<string, 1 | -1>;
  readonly name: string;
  readonly expireAfterSeconds?: number;
  readonly unique?: boolean;
}

export interface CollectionDefinition {
  readonly name: string;
  readonly indexes: readonly IndexDefinition[];
}

export const ANALYTICS_COLLECTIONS: readonly CollectionDefinition[] = [
  {
    name: 'page_views',
    indexes: [
      { key: { createdAt: 1 }, name: 'ttl_page_views', expireAfterSeconds: 30 * 24 * 60 * 60 },
      { key: { sessionId: 1, createdAt: -1 }, name: 'session_views' },
    ],
  },
  {
    name: 'cart_events',
    indexes: [
      { key: { createdAt: 1 }, name: 'ttl_cart_events', expireAfterSeconds: 60 * 24 * 60 * 60 },
      { key: { cartId: 1, createdAt: -1 }, name: 'cart_events_by_cart' },
    ],
  },
  {
    name: 'processed_events',
    indexes: [
      { key: { eventId: 1 }, name: 'processed_event_id', unique: true },
    ],
  },
];

export interface IndexDb {
  collection(name: string): {
    createIndexes(specs: readonly IndexDefinition[]): Promise<unknown>;
  };
}

export async function ensureIndexes(db: IndexDb): Promise<void> {
  for (const collection of ANALYTICS_COLLECTIONS) {
    await db.collection(collection.name).createIndexes(collection.indexes);
  }
}
