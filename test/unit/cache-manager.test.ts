import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import { CacheManager } from '../../src/core/cache-manager';

describe('Core Engine - CacheManager & Data Freshness', () => {
    it('should store and retrieve values in memory', async () => {
        const cache = new CacheManager('./data/unit-test-cache.json', 3, 100);
        await cache.set('laptop stoku var mı?', { answer: '12 adet var', intent: 'TOOL_CALL' });

        const cached = await cache.get('laptop stoku var mı?');
        assert.ok(cached !== null);
        assert.equal(cached.answer, '12 adet var');
        assert.equal(cached.intent, 'TOOL_CALL');
    });

    it('should return null for non-existent cache keys', async () => {
        const cache = new CacheManager('./data/unit-test-cache.json', 3, 100);
        const result = await cache.get('bilinmeyen bir soru');
        assert.equal(result, null);
    });

    it('should hydrate from disk on initialization', async () => {
        const tempPath = './src/utils/temp-hydrate-test.json';
        const seedData = {
            'kargo suresi nedir?': {
                answer: '2-4 is gunudur.',
                intent: 'FAQ'
            }
        };

        await fs.writeFile(tempPath, JSON.stringify(seedData), 'utf-8');

        try {
            const cache = new CacheManager(tempPath, 2);
            await cache.init();

            const result = await cache.get('kargo suresi nedir?');
            assert.ok(result !== null);
            assert.equal(result.answer, '2-4 is gunudur.');
        } finally {
            await fs.unlink(tempPath).catch(() => {});
        }
    });

    it('should delete a specific cache key and sync', async () => {
        const cache = new CacheManager('./data/unit-test-delete.json', 3, 100);
        await cache.set('laptop fiyatı nedir?', { price: 1000 });

        assert.equal(cache.has('laptop fiyatı nedir?'), true);

        const deleted = await cache.delete('laptop fiyatı nedir?');
        assert.equal(deleted, true);
        assert.equal(await cache.get('laptop fiyatı nedir?'), null);
    });

    it('should invalidate cache entries using substring and regex patterns', async () => {
        const cache = new CacheManager('./data/unit-test-invalidate.json', 3, 100);
        await cache.set('product_101_price', { price: 500 });
        await cache.set('product_101_stock', { stock: 10 });
        await cache.set('product_202_price', { price: 900 });

        // Invalidate all entries for product_101 (e.g. after price/inventory update from X to B)
        const evictedCount = await cache.invalidate('product_101');
        assert.equal(evictedCount, 2);

        assert.equal(await cache.get('product_101_price'), null);
        assert.equal(await cache.get('product_101_stock'), null);
        assert.ok(await cache.get('product_202_price') !== null);

        // Regex invalidation
        const regexEvicted = await cache.invalidate(/_price$/);
        assert.equal(regexEvicted, 1);
        assert.equal(await cache.get('product_202_price'), null);
    });

    it('should support item TTL and expire old entries automatically', async () => {
        // Create cache with 50ms TTL for testing
        const cache = new CacheManager('./data/unit-test-ttl.json', 3, 100, 50);
        await cache.set('short_lived_query', { answer: 'fresh value' }, 50);

        const immediate = await cache.get('short_lived_query');
        assert.ok(immediate !== null);
        assert.equal(immediate.answer, 'fresh value');

        // Wait for TTL to expire
        await new Promise((resolve) => setTimeout(resolve, 60));

        const expired = await cache.get('short_lived_query');
        assert.equal(expired, null, 'Expired entry must return null');
    });

    it('should clear all entries in memory and disk', async () => {
        const cache = new CacheManager('./data/unit-test-clear.json', 3, 100);
        await cache.set('q1', 'val1');
        await cache.set('q2', 'val2');
        assert.equal(cache.size(), 2);

        await cache.clear();
        assert.equal(cache.size(), 0);
        assert.equal(await cache.get('q1'), null);
    });
});
