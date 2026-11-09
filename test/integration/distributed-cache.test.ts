import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Redis from 'ioredis';
import { RedisCacheAdapter } from '../../src/adapters/cache/redis-cache.adapter';

const exec = promisify(execFile);
test('real Redis invalidation spans processes and outages cannot return stale local copies', { skip: !process.env.REDIS_TEST_URL, timeout: 20_000 }, async () => {
    const url = process.env.REDIS_TEST_URL!;
    const prefix = `test:cache:[${randomUUID()}]:`;
    const first = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
    const second = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
    first.on('error', () => {}); second.on('error', () => {});
    const a = new RedisCacheAdapter({ client: first, keyPrefix: prefix });
    const b = new RedisCacheAdapter({ client: second, keyPrefix: prefix });
    const other = new RedisCacheAdapter({ client: first, keyPrefix: prefix + 'other:' });
    try {
        await Promise.all([a.init(), b.init()]);
        const script = `
            import Redis from 'ioredis';
            import { RedisCacheAdapter } from './src/adapters/cache/redis-cache.adapter.ts';
            const client = new Redis(process.env.REDIS_TEST_URL);
            const cache = new RedisCacheAdapter({ client, keyPrefix: process.env.TEST_CACHE_PREFIX });
            try { await cache.init(); await cache.set('product:remote', {price: 100}); }
            finally { await client.quit(); }
        `;
        await exec(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
            env: { ...process.env, TEST_CACHE_PREFIX: prefix }, timeout: 10_000
        });
        assert.deepEqual(await b.get('product:remote'), { price: 100 });
        assert.equal(await a.invalidate(/product:remote$/g), 1);
        assert.equal(await b.get('product:remote'), null);
        second.disconnect();
        assert.equal(await b.get('product:remote'), null);
        await assert.rejects(b.clear());
        await other.set('retained', 1);
        for (let i = 0; i < 205; i++) await a.set(`item:${i}`, i);
        assert.equal(await a.invalidate('item:*'), 205);
        assert.equal(await other.get('retained'), 1);
        await a.clear();
        assert.equal(await other.get('retained'), null); // child prefixes belong to the parent namespace
    } finally {
        await a.clear();
        first.disconnect(); second.disconnect();
    }
});
