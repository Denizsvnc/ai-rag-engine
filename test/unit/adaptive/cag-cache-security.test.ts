import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CAGStrategy } from '../../../src/core/adaptive/strategies/cag.strategy.js';
import { CacheIdentity } from '../../../src/core/security/cache-identity.js';
import type { ICacheAdapter } from '../../../src/interfaces/cache.interface.js';

class MockMemoryCache implements ICacheAdapter {
    private store = new Map<string, unknown>();

    async get(key: string): Promise<unknown> {
        return this.store.get(key) ?? null;
    }

    async set(key: string, value: unknown, _ttlMs?: number): Promise<void> {
        this.store.set(key, value);
    }

    async delete(key: string): Promise<boolean> {
        return this.store.delete(key);
    }

    async clear(): Promise<void> {
        this.store.clear();
    }

    rawMap(): Map<string, unknown> {
        return this.store;
    }
}

describe('P0 CAGStrategy Cache Security, Authorization & Capability Honesty', () => {
    it('1. Role Isolation: Identical query from different roles must NEVER share cache', async () => {
        const cache = new MockMemoryCache();
        const cag = new CAGStrategy(cache, true);

        const adminContext = {
            query: 'Executive bonus criteria',
            tenantId: 'tenant_alpha',
            roles: ['executive_admin']
        };

        const internContext = {
            query: 'Executive bonus criteria',
            tenantId: 'tenant_alpha',
            roles: ['intern']
        };

        // Pre-populate cache for admin
        const adminKey = CacheIdentity.buildCacheKey(adminContext);
        await cache.set(adminKey, 'Confidential: 50% bonus structure');

        // Admin retrieves cached answer
        const adminRes = await cag.execute(adminContext);
        assert.strictEqual(adminRes.answerDraft, 'Confidential: 50% bonus structure');
        assert.strictEqual(adminRes.confidence, 1.0);

        // Intern asking identical question must NOT hit admin cache
        const internRes = await cag.execute(internContext);
        assert.strictEqual(internRes.answerDraft, undefined);
        assert.strictEqual(internRes.confidence, 0.0);
        assert.strictEqual(internRes.telemetry?.cacheHit, false);
    });

    it('2. Cross-Tenant Isolation: Identical query in different tenants must never collide', async () => {
        const cache = new MockMemoryCache();
        const cag = new CAGStrategy(cache, true);

        const tenantA = { query: 'Q3 financial targets', tenantId: 'tenant_A', roles: ['admin'] };
        const tenantB = { query: 'Q3 financial targets', tenantId: 'tenant_B', roles: ['admin'] };

        const keyA = CacheIdentity.buildCacheKey(tenantA);
        await cache.set(keyA, 'Tenant A confidential revenue: $50M');

        // Tenant B executes query
        const resB = await cag.execute(tenantB);
        assert.strictEqual(resB.answerDraft, undefined);
        assert.strictEqual(resB.confidence, 0.0);
    });

    it('3. Document Revision Invalidation: Updating document revision head obsoletes stale cache', async () => {
        const cache = new MockMemoryCache();
        const cag = new CAGStrategy(cache, true);

        const rev1Context = {
            query: 'What is our refund window?',
            tenantId: 'tenant_retail',
            roles: ['customer'],
            metadata: { documentRevision: 1 }
        };

        const rev2Context = {
            query: 'What is our refund window?',
            tenantId: 'tenant_retail',
            roles: ['customer'],
            metadata: { documentRevision: 2 } // Revision updated to 2
        };

        const key1 = CacheIdentity.buildCacheKey(rev1Context);
        await cache.set(key1, '14 days refund window');

        // Rev 1 hits cache
        const res1 = await cag.execute(rev1Context);
        assert.strictEqual(res1.answerDraft, '14 days refund window');

        // Rev 2 immediately invalidates old cache without explicit eviction
        const res2 = await cag.execute(rev2Context);
        assert.strictEqual(res2.answerDraft, undefined);
        assert.strictEqual(res2.confidence, 0.0);
    });

    it('4. Graph Revision Invalidation: Updating graph revision obsoletes stale GraphRAG cached answers', async () => {
        const cache = new MockMemoryCache();
        const cag = new CAGStrategy(cache, true);

        const graphRev1 = {
            query: 'Who reports to Alice?',
            tenantId: 'tenant_hr',
            roles: ['manager'],
            metadata: { graphRevision: '10' }
        };

        const graphRev2 = {
            query: 'Who reports to Alice?',
            tenantId: 'tenant_hr',
            roles: ['manager'],
            metadata: { graphRevision: '11' }
        };

        const key = CacheIdentity.buildCacheKey(graphRev1);
        await cache.set(key, 'Bob and Charlie report to Alice');

        const hit = await cag.execute(graphRev1);
        assert.strictEqual(hit.answerDraft, 'Bob and Charlie report to Alice');

        const miss = await cag.execute(graphRev2);
        assert.strictEqual(miss.answerDraft, undefined);
        assert.strictEqual(miss.confidence, 0.0);
    });

    it('5. Permission Revocation: Removing a role invalidates cache lookup', async () => {
        const cache = new MockMemoryCache();
        const cag = new CAGStrategy(cache, true);

        const userWithAdmin = {
            query: 'View audit trail',
            tenantId: 't1',
            roles: ['auditor', 'admin']
        };

        const userWithoutAdmin = {
            query: 'View audit trail',
            tenantId: 't1',
            roles: ['auditor'] // admin revoked
        };

        const key = CacheIdentity.buildCacheKey(userWithAdmin);
        await cache.set(key, 'Full administrative audit logs');

        const resRevoked = await cag.execute(userWithoutAdmin);
        assert.strictEqual(resRevoked.answerDraft, undefined);
        assert.strictEqual(resRevoked.confidence, 0.0);
    });

    it('6. Cryptographic Hash Collision Resistance: Query text is not truncated or weak polynomial', async () => {
        const query1 = 'Why is the sky blue?';
        const query2 = 'Why is the sea blue?';

        const key1 = CacheIdentity.buildCacheKey({ tenantId: 't1', query: query1 });
        const key2 = CacheIdentity.buildCacheKey({ tenantId: 't1', query: query2 });

        assert.notStrictEqual(key1, key2);
        // Does not expose plaintext query in cache key
        assert.strictEqual(key1.includes('Why is the sky blue?'), false);
        assert.strictEqual(key2.includes('Why is the sea blue?'), false);
    });

    it('7. Native KV-Cache Capability Honesty: Degrades gracefully when provider lacks native KV support', async () => {
        const cache = new MockMemoryCache();

        // Consumer requests native KV-cache, but nativeKvCapability is false (not supported by model)
        const cag = new CAGStrategy(cache, {
            enabled: true,
            cacheType: 'native_model_kv',
            nativeKvCapability: false // Real capability check returns false
        });

        const ctx = { query: 'test query', tenantId: 't1' };
        const key = CacheIdentity.buildCacheKey(ctx);
        await cache.set(key, 'Cached response');

        const res = await cag.execute(ctx);
        assert.strictEqual(res.success, true);
        assert.strictEqual(res.answerDraft, 'Cached response');

        // Must NOT falsely claim nativeKvSupported = true
        assert.strictEqual(res.evidence[0]?.metadata?.['nativeKvSupported'], false);
        assert.strictEqual(res.evidence[0]?.metadata?.['cacheType'], 'response_cache');
    });

    it('8. Native KV-Cache Capability Honesty: Reports nativeKvSupported = true only when genuinely negotiated', async () => {
        const cache = new MockMemoryCache();

        const cag = new CAGStrategy(cache, {
            enabled: true,
            cacheType: 'native_model_kv',
            nativeKvCapability: true // Genuine verified hardware/provider capability
        });

        const ctx = { query: 'test query', tenantId: 't1' };
        const key = CacheIdentity.buildCacheKey(ctx);
        await cache.set(key, 'Cached response');

        const res = await cag.execute(ctx);
        assert.strictEqual(res.evidence[0]?.metadata?.['nativeKvSupported'], true);
        assert.strictEqual(res.evidence[0]?.metadata?.['cacheType'], 'native_model_kv');
    });

    it('9. Cache Miss Integrity: Cache miss returns confidence 0.0 and never invents answerDraft', async () => {
        const cache = new MockMemoryCache();
        const cag = new CAGStrategy(cache, true);

        const res = await cag.execute({ query: 'non-existent query', tenantId: 't1' });
        assert.strictEqual(res.success, true);
        assert.strictEqual(res.confidence, 0.0);
        assert.strictEqual(res.answerDraft, undefined);
        assert.strictEqual(res.evidence.length, 0);
    });
});

