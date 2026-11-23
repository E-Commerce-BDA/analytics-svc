import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { TrackController } from './track.controller.js';
import { SlidingWindowLimiter } from './rate-limit.js';

const dto = {
  sessionId: 's1',
  page: '/home',
  eventKind: 'pageview' as const,
};

function controller(maxEvents = 2) {
  const record = vi.fn(async () => 'event-1');
  const limiter = new SlidingWindowLimiter({
    maxEvents,
    windowMs: 60_000,
    maxSessions: 10,
  });
  const ctrl = new TrackController(
    { record } as never,
    limiter,
  );
  return { ctrl, record, limiter };
}

describe('TrackController', () => {
  it('returns 202 and records the event', async () => {
    const { ctrl, record } = controller();
    const headers = { setHeader: vi.fn() } as never;
    expect(await ctrl.track(dto, headers)).toEqual({ status: 'accepted' });
    expect(record).toHaveBeenCalledOnce();
  });

  it('returns 429 with Retry-After and does not record when over the limit', async () => {
    const { ctrl, record } = controller(1);
    const setHeader = vi.fn();
    const headers = { setHeader } as never;
    await ctrl.track(dto, headers);
    await expect(ctrl.track(dto, headers)).rejects.toBeInstanceOf(HttpException);
    expect(setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect(record).toHaveBeenCalledTimes(1);
  });
});
