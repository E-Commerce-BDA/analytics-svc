import { describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('forwards both probes to the service', () => {
    const service = {
      checkLiveness: vi.fn(() => ({ status: 'ok' as const })),
      checkReadiness: vi.fn(async () => ({
        status: 'ready' as const,
        checks: { mongo: 'up' as const },
      })),
    };
    const controller = new HealthController(service as never);
    expect(controller.checkLiveness()).toEqual({ status: 'ok' });
    expect(controller.checkReadiness()).toBeDefined();
    expect(service.checkLiveness).toHaveBeenCalledOnce();
    expect(service.checkReadiness).toHaveBeenCalledOnce();
  });
});
