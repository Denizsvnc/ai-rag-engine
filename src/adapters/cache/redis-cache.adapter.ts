import { LRUCache } from 'lru-cache';
import type { ICacheAdapter } from '../../interfaces/cache.interface';

export interface IRedisClientLike {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ...args: any[]): Promise<any>;
    del(key: string | string[]): Promise<number>;
    keys?(pattern: string): Promise<string[]>;
    scan?(cursor: string, ...args: any[]): Promise<[string, string[]]>;
    quit?(): Promise<any>;
    disconnect?(): void;
    ping?(): Promise<string>;
}

export interface RedisCacheOptions {
    /** Connection URL e.g. "redis://localhost:6379" */
    url?: string | undefined;
    /** Existing or custom Redis client instance (e.g. ioredis, @redis/client) */
    client?: IRedisClientLike | undefined;
    /** Key prefix for namespace isolation (default: "rag:cache:") */
    keyPrefix?: string | undefined;
    /** Default TTL in milliseconds (default: 24 hours) */
    defaultTtlMs?: number | undefined;
    /** Enable in-memory LRU fallback when Redis is unreachable (default: true) */
    enableFallbackMemory?: boolean | undefined;
    /** Maximum items stored in the fallback in-memory cache */
    fallbackMaxItems?: number | undefined;
}

/**
 * Enterprise Centralized Redis Cache Adapter.
 * Provides distributed cache coherence across multi-instance, clustered, or horizontal container deployments.
 * Implements ICacheAdapter with automatic serialization, TTL enforcement, pattern invalidation, and graceful memory fallback.
 */
export class RedisCacheAdapter implements ICacheAdapter {
    private client: IRedisClientLike | null = null;
    private keyPrefix: string;
    private defaultTtlMs: number;
    private enableFallback: boolean;
    private fallbackCache: LRUCache<string, any>;
    private isConnected: boolean = false;

    constructor(private options: RedisCacheOptions = {}) {
        this.keyPrefix = options.keyPrefix ?? 'rag:cache:';
        this.defaultTtlMs = options.defaultTtlMs ?? 1000 * 60 * 60 * 24; // 24 hours
        this.enableFallback = options.enableFallbackMemory ?? true;

        this.fallbackCache = new LRUCache({
            max: options.fallbackMaxItems ?? 1000,
            ttl: this.defaultTtlMs
        });

        if (options.client) {
            this.client = options.client;
            this.isConnected = true;
        }
    }

    /**
     * Initializes Redis client connection if URL was provided.
     */
    public async init(): Promise<void> {
        if (this.client) {
            try {
                if (typeof this.client.ping === 'function') {
                    await this.client.ping();
                }
                this.isConnected = true;
            } catch (err) {
                console.warn('[RedisCacheAdapter] Redis ping failed, fallback enabled:', err);
                this.isConnected = false;
            }
            return;
        }

        if (this.options.url) {
            try {
                // Check if user has ioredis or @redis/client installed dynamically
                let RedisCtor: any;
                try {
                    const ioredis = await import('ioredis' as any);
                    RedisCtor = ioredis.default || ioredis.Redis;
                } catch {
                    // Try standard @redis/client or create client
                }

                if (RedisCtor) {
                    this.client = new RedisCtor(this.options.url);
                    this.isConnected = true;
                } else {
                    console.info(
                        '[RedisCacheAdapter] No external Redis library (ioredis) installed. Operating with high-speed in-memory store. Run: npm install ioredis'
                    );
                    this.isConnected = false;
                }
            } catch (error) {
                console.warn('[RedisCacheAdapter] Failed to initialize Redis connection:', error);
                this.isConnected = false;
            }
        }
    }

    public async get(key: string): Promise<any | null> {
        const fullKey = this.prefixKey(key);

        if (this.isConnected && this.client) {
            try {
                const raw = await this.client.get(fullKey);
                if (raw !== null && raw !== undefined) {
                    return JSON.parse(raw);
                }
                return null;
            } catch (err) {
                if (this.enableFallback) {
                    return this.fallbackCache.get(fullKey) ?? null;
                }
                throw err;
            }
        }

        if (this.enableFallback) {
            return this.fallbackCache.get(fullKey) ?? null;
        }

        return null;
    }

    public async set(key: string, value: any, ttlMs?: number): Promise<void> {
        const fullKey = this.prefixKey(key);
        const effectiveTtl = ttlMs ?? this.defaultTtlMs;
        const serialized = JSON.stringify(value);

        if (this.isConnected && this.client) {
            try {
                // Use PX for millisecond TTL in Redis
                await this.client.set(fullKey, serialized, 'PX', effectiveTtl);
            } catch (err) {
                if (!this.enableFallback) throw err;
            }
        }

        if (this.enableFallback) {
            this.fallbackCache.set(fullKey, value, { ttl: effectiveTtl });
        }
    }

    public async delete(key: string): Promise<boolean> {
        const fullKey = this.prefixKey(key);
        let deletedFromRedis = false;

        if (this.isConnected && this.client) {
            try {
                const res = await this.client.del(fullKey);
                deletedFromRedis = res > 0;
            } catch (err) {
                if (!this.enableFallback) throw err;
            }
        }

        const deletedFromFallback = this.fallbackCache.delete(fullKey);
        return deletedFromRedis || deletedFromFallback;
    }

    public async invalidate(patternOrKey: string | RegExp): Promise<number> {
        let count = 0;

        if (typeof patternOrKey === 'string') {
            const pattern = this.prefixKey(patternOrKey);

            if (this.isConnected && this.client) {
                try {
                    let matchingKeys: string[] = [];
                    if (typeof this.client.keys === 'function') {
                        matchingKeys = await this.client.keys(pattern);
                    } else if (typeof this.client.scan === 'function') {
                        let cursor = '0';
                        do {
                            const [nextCursor, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
                            cursor = nextCursor;
                            matchingKeys.push(...keys);
                        } while (cursor !== '0');
                    }

                    if (matchingKeys.length > 0) {
                        const delCount = await this.client.del(matchingKeys);
                        count = delCount;
                    }
                } catch (err) {
                    if (!this.enableFallback) throw err;
                }

                // Synchronize fallback cache cleanup without inflating return count
                for (const key of this.fallbackCache.keys()) {
                    if (key === pattern || (pattern.endsWith('*') && key.startsWith(pattern.slice(0, -1)))) {
                        this.fallbackCache.delete(key);
                    }
                }
            } else {
                // Invalidate in fallback cache when Redis is disconnected
                for (const key of this.fallbackCache.keys()) {
                    if (key === pattern || (pattern.endsWith('*') && key.startsWith(pattern.slice(0, -1)))) {
                        this.fallbackCache.delete(key);
                        count++;
                    }
                }
            }
        } else if (patternOrKey instanceof RegExp) {
            for (const key of this.fallbackCache.keys()) {
                if (patternOrKey.test(key)) {
                    this.fallbackCache.delete(key);
                    count++;
                }
            }
        }

        return count;
    }

    public async clear(): Promise<void> {
        if (this.isConnected && this.client) {
            try {
                let matchingKeys: string[] = [];
                if (typeof this.client.keys === 'function') {
                    matchingKeys = await this.client.keys(`${this.keyPrefix}*`);
                }
                if (matchingKeys.length > 0) {
                    await this.client.del(matchingKeys);
                }
            } catch (err) {
                if (!this.enableFallback) throw err;
            }
        }

        this.fallbackCache.clear();
    }

    public getIsConnected(): boolean {
        return this.isConnected;
    }

    public size(): number {
        return this.fallbackCache.size;
    }

    private prefixKey(key: string): string {
        return key.startsWith(this.keyPrefix) ? key : `${this.keyPrefix}${key}`;
    }
}
