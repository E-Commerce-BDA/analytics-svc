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
    // anl-003: one fact per checkout, used with cart_events for the funnel.
    name: 'order_events',
    indexes: [
      { key: { createdAt: 1 }, name: 'ttl_order_events', expireAfterSeconds: 60 * 24 * 60 * 60 },
      { key: { userId: 1, createdAt: -1 }, name: 'order_events_by_user' },
    ],
  },
  {
    // anl-003: signup cohort only. No display name - the event carries no PII
    // we need to copy, and funnels need only the id and the timestamp.
    name: 'user_events',
    indexes: [
      { key: { createdAt: 1 }, name: 'ttl_user_events', expireAfterSeconds: 60 * 24 * 60 * 60 },
      { key: { userId: 1 }, name: 'user_events_by_user' },
    ],
  },
  {
    // anl-004: one marker per cart per idle window. No TTL - it must outlive
    // the cart facts it dedupes, or a replay could send a second reminder.
    name: 'abandonment_windows',
    indexes: [
      // `_id` is unique by definition; Mongo rejects `unique: true` on an _id
      // index with code 197, which used to stop the service before /health.
      { key: { _id: 1 }, name: 'abandonment_window_id' },
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

export interface ExistingIndex {
  readonly name: string;
  readonly key: Record<string, 1 | -1>;
  readonly unique?: boolean;
}

export interface RepairableIndexDb extends IndexDb {
  collection(name: string): {
    createIndexes(specs: readonly IndexDefinition[]): Promise<unknown>;
    indexes(): Promise<readonly ExistingIndex[]>;
    dropIndex(name: string): Promise<unknown>;
  };
}

export function isInvalidUniqueIdIndex(index: ExistingIndex): boolean {
  const keys = Object.keys(index.key);
  return (
    index.unique === true &&
    keys.length === 1 &&
    keys[0] === '_id' &&
    index.name !== '_id_'
  );
}

/**
 * Drops a `unique` index on `_id` if an older build managed to create one,
 * then applies the current declarations. Mongo rejects such an index on create
 * (code 197), but an already-stored one would keep `createIndexes` failing at
 * boot, so the repair is part of the same idempotent migration as the fix.
 */
export async function repairIndexes(db: RepairableIndexDb): Promise<string[]> {
  const dropped: string[] = [];
  for (const collection of ANALYTICS_COLLECTIONS) {
    const target = db.collection(collection.name);
    for (const existing of await target.indexes()) {
      if (isInvalidUniqueIdIndex(existing)) {
        await target.dropIndex(existing.name);
        dropped.push(`${collection.name}.${existing.name}`);
      }
    }
    await target.createIndexes(collection.indexes);
  }
  return dropped;
}
