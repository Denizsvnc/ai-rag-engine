import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { RequestHandler } from 'express';

const script = `local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('PTTL', KEYS[1])}`;

/**
 * Creates an atomic distributed tenant rate limiter middleware using Redis.
 *
 * @remarks
 * Uses an atomic Lua script to track and enforce request quotas per tenant across horizontal cluster instances.
 * Sets standard rate limit HTTP headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`).
 *
 * @param redis - Redis client with Lua `eval` method support.
 * @param options - Limit, window duration in milliseconds, and key prefix.
 * @returns Express request handler middleware.
 *
 * @example
 * ```typescript
 * import { createTenantRateLimiter } from '@denizsvnc/ai-rag-engine';
 *
 * app.use('/api', createTenantRateLimiter(redisClient, {
 *   limit: 100,
 *   windowMs: 60000
 * }));
 * ```
 */
export function createTenantRateLimiter(redis: Pick<Redis, 'eval'>, options: { limit: number; windowMs: number; prefix?: string }): RequestHandler {
    if (!Number.isSafeInteger(options.limit) || options.limit < 1 || !Number.isSafeInteger(options.windowMs) || options.windowMs < 1) throw new Error('Invalid rate limit.');
    return async (req, res, next) => {
        if (!req.auth?.tenantId) { res.status(401).json({ error: 'Authentication required.' }); return; }
        const tenant = createHash('sha256').update(req.auth.tenantId).digest('hex');
        try {
            const [count, ttl] = await redis.eval(script, 1, `${options.prefix ?? 'rag:rate:'}${tenant}`, options.windowMs) as [number, number];
            res.setHeader('X-RateLimit-Limit', options.limit);
            res.setHeader('X-RateLimit-Remaining', Math.max(0, options.limit - count));
            if (count > options.limit) {
                res.setHeader('Retry-After', Math.max(1, Math.ceil(ttl / 1000)));
                res.status(429).json({ error: 'Tenant request rate exceeded.' }); return;
            }
            next();
        } catch { res.status(503).json({ error: 'Rate limiter unavailable.' }); }
    };
}
