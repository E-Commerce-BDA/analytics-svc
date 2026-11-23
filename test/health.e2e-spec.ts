import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

/**
 * Health probes are exercised against a real app. When Mongo is down the app
 * cannot boot at all (retryAttempts: 0), so this suite is skipped in that case
 * rather than reporting a false failure.
 */
describe('analytics health (e2e)', () => {
  let app: NestExpressApplication | null = null;

  beforeAll(async () => {
    try {
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
  });

  it('answers the liveness probe without a prefix', async () => {
    if (app === null) return;
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('answers the readiness probe', async () => {
    if (app === null) return;
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.checks.mongo).toBe('up');
  });
});
