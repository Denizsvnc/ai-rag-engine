import { test, describe } from 'node:test';
import assert from 'node:assert';
import { RedisCacheAdapter, type IRedisClientLike } from '../../../src/adapters/cache/redis-cache.adapter';

class MockRedisClient implements IRedisClientLike {
    public storage = new Map<string, string>();
    public pingCalls = 0;

    async ping(): Promise<string> {
        this.pingCalls++;
        return 'PONG';
    }

    async get(key: string): Promise<string | null> {
        return this.storage.get(key) ?? null;
    }

    async set(key: string, value: string): Promise<string> {
        this.storage.set(key, value);
        return 'OK';
    }

    async del(key: string | string[]): Promise<number> {
        if (Array.isArray(key)) {
            let count = 0;
            for (const k of key) {
                if (this.storage.delete(k)) count++;
            }
            return count;
        }
        return this.storage.delete(key) ? 1 : 0;
    }

    async keys(pattern: string): Promise<string[]> {
        const prefix = pattern.replace(/\*$/, '');
        const matches: string[] = [];
        for (const k of this.storage.keys()) {
            if (k.startsWith(prefix)) matches.push(k);
        }
        return matches;
    }
}

describe('Centralized Cache - RedisCacheAdapter', () => {
    test('should serialize and deserialize JSON objects through Redis mock client', async () => {
        const mockClient = new MockRedisClient();
        const adapter = new RedisCacheAdapter({
            client: mockClient,
            keyPrefix: 'test:cache:'
        });

        await adapter.init();
        assert.strictEqual(mockClient.pingCalls, 1);

        const sampleResponse = { answer: 'Paris is the capital of France.', latencyMs: 12 };
        await adapter.set('query:capital', sampleResponse, 60000);

        // Verify key stored in Redis client includes prefix and is serialized
        assert.ok(mockClient.storage.has('test:cache:query:capital'));
        const rawJson = mockClient.storage.get('test:cache:query:capital');
        assert.strictEqual(JSON.parse(rawJson!).answer, sampleResponse.answer);

        // Retrieve through adapter
        const retrieved = await adapter.get('query:capital');
        assert.deepStrictEqual(retrieved, sampleResponse);
    });

    test('should invalidate matching keys by pattern across distributed cluster', async () => {
        const mockClient = new MockRedisClient();
        const adapter = new RedisCacheAdapter({
            client: mockClient,
            keyPrefix: 'tenant_a:'
        });

        await adapter.set('user:1:orders', { total: 5 });
        await adapter.set('user:1:profile', { name: 'Alice' });
        await adapter.set('user:2:profile', { name: 'Bob' });

        assert.strictEqual(mockClient.storage.size, 3);

        const invalidatedCount = await adapter.invalidate('user:1:*');
        assert.strictEqual(invalidatedCount, 2);
        assert.strictEqual(mockClient.storage.size, 1);
        assert.ok(mockClient.storage.has('tenant_a:user:2:profile'));
    });

    test('should gracefully fall back to local in-memory LRU when Redis is disconnected', async () => {
        // Create adapter with no client and fallback enabled
        const adapter = new RedisCacheAdapter({
            keyPrefix: 'fallback:',
            enableFallbackMemory: true
        });

        await adapter.init();
        assert.strictEqual(adapter.getIsConnected(), false);

        // Fallback operations should work seamlessly without throwing
        await adapter.set('local_key', { status: 'cached_in_memory' });
        const result = await adapter.get('local_key');

        assert.deepStrictEqual(result, { status: 'cached_in_memory' });

        const deleted = await adapter.delete('local_key');
        assert.strictEqual(deleted, true);

        const afterDelete = await adapter.get('local_key');
        assert.strictEqual(afterDelete, null);
    });
});
