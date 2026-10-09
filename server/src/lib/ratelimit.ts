// Fixed-window rate limiter. In-memory for a single node; swap the store for Redis
// (INCR + EXPIRE) when running several API instances behind a load balancer.
import type { Request, Response, NextFunction } from 'express';
import { HttpError } from './http.ts';

interface Bucket {
  count: number;
  reset: number;
}
const buckets = new Map<string, Bucket>();

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 60_000).unref();

/** Returns true if the action identified by `key` is still within its limit. */
export function hit(key: string, max: number, windowMs: number): boolean {
  if (process.env.OMNIBIZ_DISABLE_RATE_LIMIT === '1') return true;
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) {
    b = { count: 0, reset: now + windowMs };
    buckets.set(key, b);
  }
  b.count++;
  return b.count <= max;
}

export function rateLimit(name: string, max: number, windowMs: number, keyFn?: (req: Request) => string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = `${name}:${keyFn ? keyFn(req) : (req.user?.id ?? req.ip)}`;
    if (!hit(key, max, windowMs)) return next(new HttpError(429, 'Too many requests. Please slow down and try again shortly.'));
    next();
  };
}

export function resetRateLimits() {
  buckets.clear();
}
