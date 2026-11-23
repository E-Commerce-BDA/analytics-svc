/**
 * Per-session sliding-window rate limit (anl-002).
 *
 * Pure and in-memory on purpose: one service, no extra dependency. Each check
 * drops timestamps older than the window, so a steady stream cannot grow the
 * array without bound. A hard cap on the number of tracked sessions stops a
 * malicious spread of session ids from exhausting memory; when the cap is hit
 * the oldest session is evicted (the next beacon from it simply starts a new
 * window).
 */

export interface RateLimitConfig {
  maxEvents: number;
  windowMs: number;
  maxSessions: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxEvents: 60,
  windowMs: 60_000,
  maxSessions: 10_000,
};

export class SlidingWindowLimiter {
  private readonly sessions = new Map<string, number[]>();

  constructor(private readonly config: RateLimitConfig = DEFAULT_RATE_LIMIT) {}

  check(sessionId: string, now: number = Date.now()): RateLimitDecision {
    const cutoff = now - this.config.windowMs;
    const timestamps = (this.sessions.get(sessionId) ?? []).filter(
      (time) => time > cutoff,
    );

    if (timestamps.length >= this.config.maxEvents) {
      this.sessions.set(sessionId, timestamps);
      const oldest = timestamps[0] ?? now;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((oldest + this.config.windowMs - now) / 1000),
        ),
      };
    }

    timestamps.push(now);
    this.setTracked(sessionId, timestamps);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Visible for unit tests: how many sessions currently hold timestamps. */
  get size(): number {
    return this.sessions.size;
  }

  private setTracked(sessionId: string, timestamps: number[]): void {
    if (!this.sessions.has(sessionId) && this.sessions.size >= this.config.maxSessions) {
      const oldest = this.sessions.keys().next().value;
      if (oldest !== undefined) this.sessions.delete(oldest);
    }
    this.sessions.set(sessionId, timestamps);
  }
}
