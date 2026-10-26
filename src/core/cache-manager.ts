import fs from 'fs/promises';
import path from 'path';
import { LRUCache } from 'lru-cache';

export class CacheManager {
    private memoryCache: LRUCache<string, any>;
    private hitCounters: Map<string, number> = new Map();
    private isPersisting = false;

    constructor(
        private filePath: string = './data/query-cache.json',
        private minHitsToPersist: number = 3,
        maxItemsInRAM: number = 1000
    ) {
        this.memoryCache = new LRUCache({
            max: maxItemsInRAM,
            ttl: 1000 * 60 * 60 * 24, // 24-hour default TTL
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
                this.memoryCache.set(key, value);
                this.hitCounters.set(key, this.minHitsToPersist);
            }
        } catch (error: any) {
            if (error.code !== 'ENOENT') {
                console.error('[Cache] Cache dosyası okunamadı:', error);
            }
        }
    }

    public async get(query: string): Promise<any | null> {
        const cached = this.memoryCache.get(query);
        if (cached) {
            const currentHits = (this.hitCounters.get(query) || 0) + 1;
            this.hitCounters.set(query, currentHits);

            // Persist to disk once minimum hit threshold is met
            if (currentHits === this.minHitsToPersist) {
                this.persistToDisk();
            }
            return cached;
        }
        return null;
    }

    public async set(query: string, value: any): Promise<void> {
        this.memoryCache.set(query, value);
        this.hitCounters.set(query, 1);
    }

    private async persistToDisk(): Promise<void> {
        if (this.isPersisting) return;
        this.isPersisting = true;

        try {
            // Only persist items exceeding the minimum hit threshold
            const dataToSave: Record<string, any> = {};
            for (const [key, hits] of this.hitCounters.entries()) {
                if (hits >= this.minHitsToPersist) {
                    const value = this.memoryCache.get(key);
                    if (value) dataToSave[key] = value;
                }
            }

            await fs.writeFile(this.filePath, JSON.stringify(dataToSave, null, 2), 'utf-8');
        } catch (error) {
            console.error('[Cache] Cache dosyaya yazılamadı:', error);
        } finally {
            this.isPersisting = false;
        }
    }
}