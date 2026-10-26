import { RAGEngine } from '../../../src/core/engine';
import type { ICacheAdapter } from '../../../src/interfaces/cache.interface';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createAuthToken, verifyAuthToken, createAuthMiddleware } from '../../../src/api/auth';
import { ConfirmationService } from '../../../src/core/security/confirmation';
import { RedisConfirmationNonceStore } from '../../../src/core/security/nonce-store';
import { LocalFaqAdapter } from '../../../src/adapters/faq/local-faq.adapter';

const secret = 'security-regression-secret-at-least-32-bytes';
const identity = { userId: 'alice', tenantId: 'alpha', roles: ['admin'] };
function signed(payload: unknown, header: unknown = { alg: 'HS256', typ: 'JWT' }): string {
    const input = [header, payload].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
    return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`;
}

test('JWT rejects signed tokens with invalid headers, claims, scope and lifetime', () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = { ...identity, iat: now, exp: now + 60, iss: 'ai-rag-engine', aud: 'ai-rag-engine-api' };
    for (const change of [
        { exp: undefined }, { exp: now }, { exp: '9999999999' }, { iat: now + 30 },
        { nbf: now + 30 }, { roles: 'admin' }, { roles: [1] }, { tenantId: '' },
        { userId: undefined }, { iss: 'other' }, { aud: 'other' }
    ]) assert.throws(() => verifyAuthToken(signed({ ...payload, ...change }), secret));
    for (const alg of ['none', 'HS512', 'RS256']) {
        assert.throws(() => verifyAuthToken(signed(payload, { alg, typ: 'JWT' }), secret));
    }
    assert.equal(verifyAuthToken(createAuthToken(identity, secret), secret).userId, 'alice');
});

test('production refuses missing/default/short secrets and anonymous auth', () => {
    const previous = { NODE_ENV: process.env.NODE_ENV, JWT_SECRET: process.env.JWT_SECRET, CONFIRMATION_SECRET: process.env.CONFIRMATION_SECRET };
    try {
        process.env.NODE_ENV = 'production';
        delete process.env.JWT_SECRET;
        delete process.env.CONFIRMATION_SECRET;
        assert.throws(() => createAuthMiddleware({}), /JWT_SECRET/);
        assert.throws(() => new ConfirmationService(), /CONFIRMATION_SECRET/);
        for (const jwtSecret of ['short', 'dev-secret-key-change-in-production']) {
            assert.throws(() => createAuthMiddleware({ jwtSecret }), /JWT_SECRET/);
        }
        assert.throws(() => createAuthMiddleware({ jwtSecret: secret, allowDevAnonymous: true }), /forbidden/);
        assert.throws(() => new ConfirmationService(secret), /distributed nonce store/);
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    }
});

test('confirmation requires exact caller identity and never falls back on store outage', async () => {
    const service = new ConfirmationService(secret);
    const target = { toolName: 'delete', args: { id: 4 }, tenantId: 'alpha', userId: 'alice' };
    const ticket = service.issueTicket(target);
    for (const change of [{ tenantId: undefined }, { userId: undefined }, { userId: 'bob' }]) {
        await assert.rejects(service.verifyTicket(ticket, { ...target, ...change }), /mismatch/);
    }
    await service.verifyTicket(ticket, target);
    await assert.rejects(service.verifyTicket(ticket, target), /consumed/);
    const failing = new ConfirmationService(secret, undefined, new RedisConfirmationNonceStore({
        async set() { throw new Error('offline'); }
    }));
    await assert.rejects(failing.verifyTicket(failing.issueTicket(target), target), /unavailable/);
    const expired = new ConfirmationService(secret, -1);
    await assert.rejects(expired.verifyTicket(expired.issueTicket(target), target), /expired/);
});

test('FAQ tenant content is denied without tenant context in listing and semantic search', async () => {
    const adapter = new LocalFaqAdapter({ smlEngine: { async getEmbedding() { return new Float32Array([1, 0]); } } as any });
    await adapter.setFaqs([
        { tenantId: 'alpha', question: 'secret', answer: 'private', embedding: [1, 0] },
        { question: 'public', answer: 'public', embedding: [0, 1] }
    ]);
    assert.deepEqual((await adapter.getFaqs()).map(item => item.answer), ['public']);
    assert.equal(await adapter.findBestMatch('secret', 0.8), null);
    assert.equal(await adapter.findBestMatch('secret', 0.8, 'beta'), null);
    assert.equal((await adapter.findBestMatch('secret', 0.8, 'alpha'))?.answer, 'private');
});


test('cache isolates users with identical roles and canonicalizes role scopes without collisions', async () => {
    const storage = new Map<string, unknown>();
    const cache: ICacheAdapter = {
        async get(key) { return storage.get(key) ?? null; },
        async set(key, value) { storage.set(key, value); },
        async delete(key) { return storage.delete(key); },
        async invalidate() { return 0; },
        async clear() { storage.clear(); }
    };
    let calls = 0;
    const engine = new RAGEngine({
        llmProvider: { async generate() { return { content: `private response ${++calls}` }; } },
        inputs: { vectorStore: { async search() { return []; } } },
        smlConfig: { enabled: false }, cache: { enabled: true, adapter: cache }
    });
    await engine.init();
    const query = 'my account details';
    const alice = { tenantId: 'alpha', userId: 'alice', roles: ['user'] };
    const first = await engine.query(query, alice);
    assert.equal((await engine.query(query, alice)).resolvedBy, 'CACHE');
    const second = await engine.query(query, { ...alice, userId: 'bob' });
    assert.notEqual(first.answer, second.answer);
    await engine.query(query, { ...alice, roles: ['a,b'] });
    await engine.query(query, { ...alice, roles: ['a', 'b'] });
    assert.equal(calls, 4);
});
