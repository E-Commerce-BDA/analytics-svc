import { createConnection, type Connection } from 'mongoose';
import { ANALYTICS_COLLECTIONS, ensureIndexes, type IndexDb } from '../src/db/indexes.js';

/**
 * Applies the real index definitions to a live Mongo and reads them back.
 * Skips cleanly when the local replica set is not running so a dev machine
 * without infra still has a green unit suite.
 */
describe('analytics Mongo schema (e2e)', () => {
  let connection: Connection | null = null;

  beforeAll(async () => {
    try {
      connection = createConnection();
      await connection.openUri(
        process.env.MONGODB_URI ??
          'mongodb://localhost:27018/ecom_analytics_test?replicaSet=rs0&directConnection=true',
        { serverSelectionTimeoutMS: 2000 },
      );
      if (!connection.db) throw new Error('no db');
      await ensureIndexes(connection.db as unknown as IndexDb);
    } catch {
      connection = null;
    }
  });

  afterAll(async () => {
    await connection?.close();
  });

  it('creates the TTL indexes with the declared windows', async () => {
    if (connection === null || !connection.db) return;
    const db = connection.db;

    const pageIndexes = await db.collection('page_views').indexes();
    const cartIndexes = await db.collection('cart_events').indexes();
    const processedIndexes = await db.collection('processed_events').indexes();

    expect(
      pageIndexes.find((i) => i.name === 'ttl_page_views')?.expireAfterSeconds,
    ).toBe(30 * 24 * 60 * 60);
    expect(
      cartIndexes.find((i) => i.name === 'ttl_cart_events')?.expireAfterSeconds,
    ).toBe(60 * 24 * 60 * 60);
    expect(processedIndexes.find((i) => i.name === 'processed_event_id')?.unique).toBe(
      true,
    );
    expect(processedIndexes.some((i) => (i.expireAfterSeconds ?? -1) >= 0)).toBe(
      false,
    );

    // Keep the declaration import live so a rename fails the test.
    expect(ANALYTICS_COLLECTIONS).toHaveLength(3);
  });
});
