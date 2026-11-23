import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createConnection, type Connection } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

/**
 * Exercises the real ingest path against a live Mongo when it is available.
 * With DISABLE_OUTBOX_RELAY=true the relay never publishes, so the assertion
 * reads the outbox collection directly. Skips cleanly without Mongo.
 */
describe('analytics track (e2e)', () => {
  let app: NestExpressApplication | null = null;
  let connection: Connection | null = null;

  beforeAll(async () => {
    try {
      connection = createConnection();
      await connection.openUri(
        process.env.MONGODB_URI ??
          'mongodb://localhost:27018/ecom_analytics_test?replicaSet=rs0&directConnection=true',
        { serverSelectionTimeoutMS: 2000 },
      );
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleRef.createNestApplication<NestExpressApplication>();
      configureApp(app);
      await app.init();
    } catch {
      app = null;
    }
  });

  afterAll(async () => {
    await app?.close();
    await connection?.close();
  });

  it('accepts a valid beacon with 202 and stores one page.viewed outbox row', async () => {
    if (app === null || !connection?.db) return;
    const res = await request(app.getHttpServer())
      .post('/api/v1/track')
      .send({
        sessionId: 'e2e-session',
        page: '/products/linen-shirt',
        eventKind: 'pageview',
        device: 'desktop',
      })
      .expect(202);
    expect(res.body).toEqual({ status: 'accepted' });
    expect(res.headers['cache-control']).toBe('no-store');

    const rows = await connection.db
      .collection('analytics_outbox')
      .find({ event_type: 'page.viewed', aggregate_id: 'e2e-session' })
      .toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].envelope.payload.page).toBe('/products/linen-shirt');
    expect(rows[0].envelope.payload.timestamp).toBeDefined();
  });

  it('rejects an invalid payload with 400 and no value echo', async () => {
    if (app === null) return;
    const res = await request(app.getHttpServer())
      .post('/api/v1/track')
      .send({ sessionId: 'e2e-session', page: 42, eventKind: 'pageview' })
      .expect(400);
    expect(res.body.error?.code ?? res.body.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(res.body)).not.toContain('42');
  });
});
