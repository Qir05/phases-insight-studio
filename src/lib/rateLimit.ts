import type { NextRequest } from 'next/server';

/**
 * Best-effort fixed-window rate limiter kept in function memory.
 * On Vercel each warm instance has its own counter, so this slows down
 * casual abuse (scripted submissions, AI-cost burning) but is not a hard
 * global limit — use Vercel Firewall / Upstash for that in production.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 5000) {
      buckets.forEach((b, k) => { if (b.resetAt <= now) buckets.delete(k); });
    }
    return { ok: true, retryAfter: 0 };
  }
  bucket.count++;
  if (bucket.count > limit) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}
