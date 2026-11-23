import { describe, expect, it, vi } from 'vitest';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  it('reports liveness without touching Mongo', () => {
    const ping = vi.fn();
    const connection = { db: { admin: () => ({ ping }) } } as never;
    const service = new HealthService(connection);
    expect(service.checkLiveness()).toEqual({ status: 'ok' });
    expect(ping).not.toHaveBeenCalled();
  });

  it('reports ready when Mongo answers the ping', async () => {
    const ping = vi.fn(async () => ({ ok: 1 }));
    const connection = { db: { admin: () => ({ ping }) } } as never;
    const service = new HealthService(connection);
    expect(await service.checkReadiness()).toEqual({
      status: 'ready',
      checks: { mongo: 'up' },
    });
    expect(ping).toHaveBeenCalledOnce();
  });

  it('reports 503 when the connection is missing', async () => {
    const service = new HealthService({ db: null } as never);
    await expect(service.checkReadiness()).rejects.toMatchObject({
      status: 503,
      response: { status: 'not_ready', checks: { mongo: 'down' } },
    });
  });
});
