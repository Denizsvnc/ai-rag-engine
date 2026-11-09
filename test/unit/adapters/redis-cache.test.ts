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


test('regex invalidation deletes remote entries and preserves other namespaces', async () => {
    const client = new MockRedisClient();
    const a = new RedisCacheAdapter({ client, keyPrefix: 'scope:' });
    const b = new RedisCacheAdapter({ client, keyPrefix: 'other:' });
    await a.set('product:1', { price: 10 });
    await a.set('product:2', { price: 20 });
    await b.set('product:1', { price: 30 });
    const pattern = /product/g;
    pattern.lastIndex = 3;
    assert.equal(await a.invalidate(pattern), 2);
    assert.equal(pattern.lastIndex, 3);
    assert.equal(await a.get('product:1'), null);
    assert.deepEqual(await b.get('product:1'), { price: 30 });
});

test('SCAN is preferred and clear handles duplicate and empty pages', async () => {
    const base = new MockRedisClient();
    await base.set('scope:1', '1'); await base.set('scope:2', '2'); await base.set('other:1', '3');
    const calls: string[] = [];
    const client = {
        get: base.get.bind(base), set: base.set.bind(base), del: base.del.bind(base),
        async keys() { throw new Error('KEYS must not run when SCAN exists'); },
        async scan(cursor: string): Promise<[string, string[]]> {
            calls.push(cursor);
            if (cursor === '0') return ['1', ['scope:1', 'scope:1']];
            if (cursor === '1') return ['2', []];
            return ['0', ['scope:2', 'other:1']];
        }
    };
    await new RedisCacheAdapter({ client, keyPrefix: 'scope:' }).clear();
    assert.deepEqual(calls, ['0', '1', '2']);
    assert.deepEqual([...base.storage.keys()], ['other:1']);
});

test('keyword invalidation matches query keys consistently with memory cache', async () => {
    const client = new MockRedisClient();
    const cache = new RedisCacheAdapter({ client });
    await cache.set('tenant:alpha:what is LAPTOP stock?', 1);
    await cache.set('tenant:alpha:phone stock?', 2);
    assert.equal(await cache.invalidate('laptop'), 1);
    assert.equal(await cache.get('tenant:alpha:what is LAPTOP stock?'), null);
    assert.equal(await cache.get('tenant:alpha:phone stock?'), 2);
});

test('remote outages never resurrect invalidated local copies or acknowledge invalidation', async () => {
    const base = new MockRedisClient();
    let offline = false;
    const client = {
        set: base.set.bind(base),
        async keys(pattern: string) { if (offline) throw new Error('offline'); return base.keys(pattern); },
        async get(key: string) { if (offline) throw new Error('offline'); return base.get(key); },
        async del(key: string | string[]) { if (offline) throw new Error('offline'); return base.del(key); }
    };
    const a = new RedisCacheAdapter({ client });
    const b = new RedisCacheAdapter({ client });
    await b.set('product', { price: 100 });
    await a.delete('product');
    offline = true;
    assert.equal(await b.get('product'), null);
    await assert.rejects(b.invalidate(/product/), /offline/);
    await assert.rejects(b.clear(), /offline/);
    offline = false;
    await a.set('product', { price: 80 });
    assert.deepEqual(await b.get('product'), { price: 80 });
});

test('missing enumeration capabilities fail explicitly; strict mode propagates read errors', async () => {
    const client = { async get() { throw new Error('offline'); }, async set() { return 'OK'; }, async del() { return 0; } };
    const cache = new RedisCacheAdapter({ client, enableFallbackMemory: false });
    await assert.rejects(cache.get('x'), /offline/);
    await assert.rejects(cache.clear(), /SCAN|KEYS/);
});
