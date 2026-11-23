import { describe, expect, it, vi } from 'vitest';
import { TrackService } from './track.service.js';

const dto = {
  sessionId: 'session-1',
  page: '/products/linen-shirt',
  eventKind: 'pageview' as const,
  timestamp: '2020-01-01T00:00:00.000Z',
};

describe('TrackService', () => {
  it('stamps server time and writes one outbox row keyed by session', async () => {
    const record = vi.fn(async () => 'event-1');
    const transactions = {
      run: vi.fn(async (fn: (session: unknown) => Promise<string>) => fn({})),
    };
    const service = new TrackService(
      { record } as never,
      transactions as never,
    );

    const id = await service.record(dto);
    expect(id).toBe('event-1');
    expect(record).toHaveBeenCalledOnce();
    const calls = record.mock.calls as unknown as Array<[
      unknown,
      { aggregateId: string; payload: { timestamp: string } },
    ]>;
    const write = calls[0][1];
    expect(write.aggregateId).toBe('session-1');
    expect(write.payload.timestamp).not.toBe('2020-01-01T00:00:00.000Z');
    expect(Number.isNaN(Date.parse(write.payload.timestamp))).toBe(false);
  });
});
