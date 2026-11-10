import { Redis } from 'ioredis';
import { LRUCache } from 'lru-cache';
import type { ICacheAdapter } from '../../interfaces/cache.interface.js';

/**
 * Contract for Redis client instances compatible with `ioredis`.
 */
export interface IRedisClientLike {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
    del(key: string): Promise<number>;
    del(keys: string[]): Promise<number>;
    keys?(pattern: string): Promise<string[]>;
    scan?(cursor: string, ...args: unknown[]): Promise<[string, string[]]>;
    quit?(): Promise<unknown>;
    disconnect?(): void;
    ping?(): Promise<string>;
}

/**
 * Configuration options for distributed Redis caching.
 */
export interface RedisCacheOptions {
    /** Redis connection URL (e.g. `'redis://127.0.0.1:6379'`). */
    url?: string | undefined;
    /** Existing `ioredis` client instance to reuse connections. */
    client?: IRedisClientLike | undefined;
    /** Key prefix prepended to all cached entries in Redis. Defaults to `'rag:cache:'`. */
    keyPrefix?: string | undefined;
    /** Default TTL in milliseconds. Defaults to 86,400,000 (24 hours). */
    defaultTtlMs?: number | undefined;
    /** When true, falls back to in-memory LRU cache if Redis is unavailable. Defaults to `true`. */
    enableFallbackMemory?: boolean | undefined;
    /** Maximum entries retained in the fallback in-memory cache. Defaults to 1000. */
    fallbackMaxItems?: number | undefined;
}

/**
 * Distributed cache adapter powered by Redis with automatic JSON serialization and fail-safe local fallback.
 *
 * @example
 * ```typescript
 * const cache = new RedisCacheAdapter({
 *   url: process.env.REDIS_URL,
 *   keyPrefix: 'rag:prod:',
 *   defaultTtlMs: 3600000 // 1 hour
 * });
 * ```
 */
export class RedisCacheAdapter implements ICacheAdapter {
    private client: IRedisClientLike | null;
    private readonly keyPrefix: string;
    private readonly defaultTtlMs: number;
    private readonly enableFallback: boolean;
    private readonly remoteConfigured: boolean;
    private readonly fallbackCache: LRUCache<string, unknown & {}>;
    private isConnected = false;

    constructor(private options: RedisCacheOptions = {}) {
        this.keyPrefix = options.keyPrefix ?? 'rag:cache:';
        if (!this.keyPrefix) throw new Error('Redis cache keyPrefix must not be empty.');
        this.defaultTtlMs = options.defaultTtlMs ?? 86_400_000;
        this.enableFallback = options.enableFallbackMemory ?? true;
        this.remoteConfigured = Boolean(options.client || options.url);
        this.client = options.client ?? null;
        this.isConnected = Boolean(this.client);
        this.fallbackCache = new LRUCache<string, unknown & {}>({ max: options.fallbackMaxItems ?? 1000, ttl: this.defaultTtlMs });
    }

    public async init(): Promise<void> {
        try {
            if (!this.client && this.options.url) {
                const client = new Redis(this.options.url, {
                    lazyConnect: true, enableOfflineQueue: false,
                    maxRetriesPerRequest: 1, connectTimeout: 1000, commandTimeout: 1000
                });
                client.on('error', () => {}); // Command promises handle failures.
                this.client = client;
                await client.connect();
            }
            if (this.client) {
                await this.client.ping?.();
                this.isConnected = true;
            }
        } catch (error) {
            this.isConnected = false;
            if (!this.enableFallback) throw error;
        }
    }

    public async get(key: string): Promise<unknown | null> {
        const fullKey = this.prefixKey(key);
        if (!this.remoteConfigured) return this.enableFallback ? this.fallbackCache.get(fullKey) ?? null : null;
        try {
            const raw = await this.requireClient().get(fullKey);
            const result = raw === null ? null : JSON.parse(raw);
            this.isConnected = true;
            return result;
        } catch (error) {
            this.isConnected = false;
            if (!this.enableFallback) throw error;
            return null;
        }
    }

    public async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
        const fullKey = this.prefixKey(key);
        const ttl = ttlMs ?? this.defaultTtlMs;
        if (!Number.isFinite(ttl) || ttl <= 0) throw new Error('Cache TTL must be positive and finite.');
        if (!this.remoteConfigured) {
            if (this.enableFallback && value !== undefined && value !== null) {
                this.fallbackCache.set(fullKey, value as {}, { ttl });
            }
            return;
        }
        const serialized = JSON.stringify(value);
        try {
            await this.requireClient().set(fullKey, serialized, 'PX', ttl);
            this.isConnected = true;
        } catch (error) {
            this.isConnected = false;
            if (!this.enableFallback) throw error;
        }
    }

    public async delete(key: string): Promise<boolean> {
        if (!this.remoteConfigured) return this.fallbackCache.delete(this.prefixKey(key));
        // Invalidation errors always propagate: a failed eviction cannot be acknowledged.
        return await this.requireClient().del(this.prefixKey(key)) > 0;
    }

    /** Strings match keywords (case-insensitive), or anchored * / ? wildcard patterns. Regexes match namespaced keys. */
    public async invalidate(patternOrKey: string | RegExp): Promise<number> {
        return this.removeMatching(this.matcher(patternOrKey));
    }

    public async clear(): Promise<void> {
        await this.removeMatching(() => true);
    }

    public getIsConnected(): boolean { return this.isConnected; }

    /** Number of local-only LRU entries; not a Redis key count. */
    public size(): number { return this.fallbackCache.size; }

    private async removeMatching(matches: (key: string) => boolean): Promise<number> {
        if (!this.remoteConfigured) {
            let removed = 0;
            for (const key of this.fallbackCache.keys()) {
                if (matches(key)) removed += Number(this.fallbackCache.delete(key));
            }
            return removed;
        }
        const client = this.requireClient();
        let removed = 0;
        for await (const keys of this.keyBatches(client)) {
            const matching = [...new Set(keys)].filter(key => key.startsWith(this.keyPrefix) && matches(key));
            for (let i = 0; i < matching.length; i += 100) {
                removed += await client.del(matching.slice(i, i + 100));
            }
        }
        return removed;
    }

    private async *keyBatches(client: IRedisClientLike): AsyncGenerator<string[]> {
        const namespace = this.keyPrefix.replace(/[\\*?\[\]]/g, '\\$&') + '*';
        if (client.scan) {
            let cursor = '0';
            do {
                const [next, keys] = await client.scan(cursor, 'MATCH', namespace, 'COUNT', 100);
                cursor = next;
                yield keys;
            } while (cursor !== '0');
        } else if (client.keys) {
            // Compatibility for small custom clients; production ioredis uses SCAN.
            yield await client.keys(namespace);
        } else {
            throw new Error('Redis invalidation requires SCAN or KEYS support.');
        }
    }

    private matcher(pattern: string | RegExp): (key: string) => boolean {
        if (pattern instanceof RegExp) {
            const regex = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''));
            return key => regex.test(key);
        }
        if (!pattern.includes('*') && !pattern.includes('?')) {
            const keyword = pattern.toLowerCase();
            return key => key.toLowerCase().includes(keyword);
        }
        const escaped = this.prefixKey(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp('^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 's');
        return key => regex.test(key);
    }

    private requireClient(): IRedisClientLike {
        if (!this.client) throw new Error('Redis cache is not initialized.');
        return this.client;
    }

    private prefixKey(key: string): string {
        return key.startsWith(this.keyPrefix) ? key : `${this.keyPrefix}${key}`;
    }
}
