import fs from 'fs/promises';
import path from 'path';
import { LRUCache } from 'lru-cache';
import type { ICacheAdapter } from '../interfaces/cache.interface';

export class CacheManager implements ICacheAdapter {
    private memoryCache: LRUCache<string, any>;
    private hitCounters: LRUCache<string, number>;
    private isPersisting = false;
    private defaultTtlMs: number;

    constructor(
        private filePath: string = './data/query-cache.json',
        private minHitsToPersist: number = 3,
        maxItemsInRAM: number = 1000,
        defaultTtlMs: number = 1000 * 60 * 60 * 24 // 24-hour default TTL
    ) {
        this.defaultTtlMs = defaultTtlMs;
        this.memoryCache = new LRUCache({
            max: maxItemsInRAM,
            ttl: this.defaultTtlMs,
            updateAgeOnGet: false
        });
        // Bounded LRU to prevent memory leak when millions of queries cycle through
        this.hitCounters = new LRUCache({
            max: maxItemsInRAM * 3,
            ttl: this.defaultTtlMs
        });
    }

    public async init(): Promise<void> {
        try {
            await fs.mkdir(path.dirname(this.filePath), { recursive: true });
            const fileData = await fs.readFile(this.filePath, 'utf-8');
            const parsedData = JSON.parse(fileData);

            // Hydrate in-memory cache from persistent storage
            for (const [key, value] of Object.entries(parsedData)) {
                if (key.startsWith('_')) continue; // Skip metadata notices and comments
                this.memoryCache.set(key, value, { ttl: this.defaultTtlMs });
                this.hitCounters.set(key, this.minHitsToPersist);
            }
        } catch (error: any) {
            if (error.code !== 'ENOENT') {
                console.error('[Cache] Cache file could not be read:', error);
            }
        }
    }

    public async get(query: string): Promise<any | null> {
        const cached = this.memoryCache.get(query);
        if (cached !== undefined) {
            const currentHits = (this.hitCounters.get(query) || 0) + 1;
            this.hitCounters.set(query, currentHits);

            // Persist to disk once minimum hit threshold is met
            if (currentHits === this.minHitsToPersist) {
                await this.persistToDisk();
            }
            return cached;
        }
        return null;
    }

    public async set(query: string, value: any, ttlMs?: number): Promise<void> {
        const itemTtl = ttlMs !== undefined ? ttlMs : this.defaultTtlMs;
        this.memoryCache.set(query, value, { ttl: itemTtl });
        this.hitCounters.set(query, 1);
    }

    /**
     * Delete a single entry by query key and synchronize disk storage
     */
    public async delete(query: string): Promise<boolean> {
        const hadKey = this.memoryCache.has(query);
        this.memoryCache.delete(query);
        this.hitCounters.delete(query);

        if (hadKey) {
            await this.persistToDisk();
        }
        return hadKey;
    }

    /**
     * Invalidate cache entries by exact key or regular expression.
     * Useful for webhook cache eviction when product prices or warehouse inventory change.
     */
    public async invalidate(patternOrKey: string | RegExp): Promise<number> {
        let evictedCount = 0;
        const keysToEvict: string[] = [];

        for (const key of this.memoryCache.keys()) {
            if (typeof patternOrKey === 'string') {
                if (key === patternOrKey || key.toLowerCase().includes(patternOrKey.toLowerCase())) {
                    keysToEvict.push(key);
                }
            } else if (patternOrKey instanceof RegExp) {
                if (patternOrKey.test(key)) {
                    keysToEvict.push(key);
                }
            }
        }

        for (const key of keysToEvict) {
            this.memoryCache.delete(key);
            this.hitCounters.delete(key);
            evictedCount++;
        }

        if (evictedCount > 0) {
            await this.persistToDisk();
        }

        return evictedCount;
    }

    /**
     * Evict all cached queries from memory and reset persistent disk storage
     */
    public async clear(): Promise<void> {
        this.memoryCache.clear();
        this.hitCounters.clear();
        await this.persistToDisk();
    }

    public has(query: string): boolean {
        return this.memoryCache.has(query);
    }

    public size(): number {
        return this.memoryCache.size;
    }

    private async persistToDisk(): Promise<void> {
        if (this.isPersisting) return;
        this.isPersisting = true;

        const tmpPath = `${this.filePath}.tmp.${Date.now()}_${Math.random().toString(36).substring(7)}`;

        try {
            const dataToSave: Record<string, any> = {};
            for (const [key, hits] of this.hitCounters.entries()) {
                if (hits >= this.minHitsToPersist) {
                    const value = this.memoryCache.get(key);
                    if (value !== undefined) {
                        dataToSave[key] = value;
                    }
                }
            }

            await fs.mkdir(path.dirname(this.filePath), { recursive: true });
            // Write to temporary file first
            await fs.writeFile(tmpPath, JSON.stringify(dataToSave, null, 2), 'utf-8');
            // Atomically replace target cache file
            await fs.rename(tmpPath, this.filePath);
        } catch (error) {
            console.error('[Cache] Cache could not be written to disk atomically:', error);
            // Clean up temporary file on failure
            try {
                await fs.unlink(tmpPath);
            } catch {
                // Ignore unlink errors
            }
        } finally {
            this.isPersisting = false;
        }
    }
}