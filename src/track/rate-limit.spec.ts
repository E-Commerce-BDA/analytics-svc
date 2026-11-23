import { describe, expect, it } from 'vitest';
import { DEFAULT_RATE_LIMIT, SlidingWindowLimiter } from './rate-limit.js';

describe('SlidingWindowLimiter', () => {
  it('allows up to the configured number of events per session', () => {
    const limiter = new SlidingWindowLimiter({ maxEvents: 2, windowMs: 1000, maxSessions: 10 });
    expect(limiter.check('s1', 0).allowed).toBe(true);
    expect(limiter.check('s1', 100).allowed).toBe(true);
    const third = limiter.check('s1', 200);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBe(1);
  });

  it('isolates sessions', () => {
    const limiter = new SlidingWindowLimiter({ maxEvents: 1, windowMs: 1000, maxSessions: 10 });
    expect(limiter.check('s1', 0).allowed).toBe(true);
    expect(limiter.check('s2', 0).allowed).toBe(true);
    expect(limiter.check('s1', 0).allowed).toBe(false);
  });

  it('frees capacity after the window rolls over', () => {
    const limiter = new SlidingWindowLimiter({ maxEvents: 1, windowMs: 1000, maxSessions: 10 });
    expect(limiter.check('s1', 0).allowed).toBe(true);
    expect(limiter.check('s1', 500).allowed).toBe(false);
    expect(limiter.check('s1', 1001).allowed).toBe(true);
  });

  it('caps the number of tracked sessions by evicting the oldest', () => {
    const limiter = new SlidingWindowLimiter({ maxEvents: 1, windowMs: 1000, maxSessions: 2 });
    limiter.check('a', 0);
    limiter.check('b', 0);
    expect(limiter.size).toBe(2);
    limiter.check('c', 0);
    expect(limiter.size).toBe(2);
    expect(limiter.check('a', 0).allowed).toBe(true);
  });

  it('exposes the documented defaults', () => {
    expect(DEFAULT_RATE_LIMIT.maxEvents).toBe(60);
    expect(DEFAULT_RATE_LIMIT.windowMs).toBe(60_000);
  });
});
