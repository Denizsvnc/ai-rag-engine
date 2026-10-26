import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import { CacheManager } from '../../src/core/cache-manager';

describe('Core Engine - CacheManager', () => {
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
});
