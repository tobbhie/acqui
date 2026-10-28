import type { Context, MiddlewareHandler } from 'hono';
import { ApiError } from './errors';

/**
 * In-memory fixed-window limiter. Correct for a single API instance; with several replicas each keeps
 * its own window (Redis is out of scope for the MVP). Keys are hashed ids, never raw secrets.
 */
export class FixedWindowLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  hit(key: string): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
    const now = this.now();
    if (this.hits.size > 10_000) this.sweep(now);
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, entry);
    }
    entry.count += 1;
    return {
      allowed: entry.count <= this.limit,
      remaining: Math.max(0, this.limit - entry.count),
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}

export function rateLimit(limiter: FixedWindowLimiter, keyOf: (c: Context) => string): MiddlewareHandler {
  return async (c, next) => {
    const result = limiter.hit(keyOf(c));
    c.header('X-RateLimit-Remaining', String(result.remaining));
    if (!result.allowed) {
      c.header('Retry-After', String(result.retryAfterSeconds));
      throw new ApiError(429, 'rate_limited', 'Too many requests');
    }
    await next();
  };
}
