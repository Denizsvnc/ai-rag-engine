import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createAuthToken,
    verifyAuthToken,
    createAuthMiddleware,
    requireRoles
} from '../../../src/api/auth';
import type { Request, Response } from 'express';

test('Security Layer - JWT Authentication & RBAC Guard', async (t) => {
    const testSecret = 'super-secret-test-key-256-bit-minimum-len!';

    await t.test('createAuthToken & verifyAuthToken - Valid token round-trip', () => {
        const payload = {
            userId: 'usr_42',
            tenantId: 'tenant_acme',
            roles: ['admin', 'billing_manager']
        };

        const token = createAuthToken(payload, testSecret, 3600);
        assert.ok(typeof token === 'string');
        assert.equal(token.split('.').length, 3);

        const decoded = verifyAuthToken(token, testSecret);
        assert.equal(decoded.userId, 'usr_42');
        assert.equal(decoded.tenantId, 'tenant_acme');
        assert.deepEqual(decoded.roles, ['admin', 'billing_manager']);
        assert.ok(decoded.exp! > Math.floor(Date.now() / 1000));
    });

    await t.test('verifyAuthToken - Rejects tampered signature (integrity failure)', () => {
        const token = createAuthToken({ userId: 'alice', tenantId: 't1', roles: ['user'] }, testSecret);
        const [h, p, s] = token.split('.');
        const tamperedSignature = s!.slice(0, -3) + 'abc';
        const tamperedToken = `${h}.${p}.${tamperedSignature}`;

        assert.throws(
            () => verifyAuthToken(tamperedToken, testSecret),
            /Invalid token signature/
        );
    });

    await t.test('verifyAuthToken - Rejects tampered payload with original signature', () => {
        const token = createAuthToken({ userId: 'alice', tenantId: 't1', roles: ['user'] }, testSecret);
        const [h, , s] = token.split('.');
        const fakePayload = Buffer.from(JSON.stringify({ userId: 'alice', tenantId: 't1', roles: ['superadmin'] }))
            .toString('base64url');
        const forgedToken = `${h}.${fakePayload}.${s}`;

        assert.throws(
            () => verifyAuthToken(forgedToken, testSecret),
            /Invalid token signature/
        );
    });

    await t.test('verifyAuthToken - Rejects expired token', () => {
        const expiredToken = createAuthToken({ userId: 'bob', tenantId: 't1', roles: ['user'] }, testSecret, -10);
        assert.throws(
            () => verifyAuthToken(expiredToken, testSecret),
            /Token has expired/
        );
    });

    await t.test('verifyAuthToken - Rejects malformed token strings', () => {
        assert.throws(() => verifyAuthToken('invalid.token', testSecret), /Malformed JWT token structure/);
        assert.throws(() => verifyAuthToken('', testSecret), /Malformed JWT token structure/);
    });

    await t.test('createAuthMiddleware - Blocks unauthenticated requests in production', () => {
        const middleware = createAuthMiddleware({
            jwtSecret: testSecret,
            allowDevAnonymous: false
        });

        let statusCode = 0;
        let responseJson: any = null;
        let nextCalled = false;

        const req = { headers: {} } as unknown as Request;
        const res = {
            status: (code: number) => {
                statusCode = code;
                return {
                    json: (data: any) => { responseJson = data; }
                };
            }
        } as unknown as Response;

        middleware(req, res, () => { nextCalled = true; });

        assert.equal(nextCalled, false);
        assert.equal(statusCode, 401);
        assert.ok(responseJson.error?.includes('Authentication required'));
    });

    await t.test('createAuthMiddleware - Prevents client header role spoofing', () => {
        const middleware = createAuthMiddleware({
            jwtSecret: testSecret,
            allowDevAnonymous: false
        });

        // Malicious client tries to impersonate superadmin and another tenant via raw HTTP headers
        const validToken = createAuthToken({
            userId: 'regular_user',
            tenantId: 'tenant_low_priv',
            roles: ['user']
        }, testSecret);

        let nextCalled = false;
        const req = {
            headers: {
                'authorization': `Bearer ${validToken}`,
                'x-roles': 'superadmin,admin',
                'x-tenant-id': 'tenant_victim_corp',
                'x-user-id': 'hacker_root'
            }
        } as unknown as Request;
        const res = {} as unknown as Response;

        middleware(req, res, () => { nextCalled = true; });

        assert.equal(nextCalled, true);
        // req.auth MUST reflect cryptographic JWT values, strictly ignoring spoofed headers
        assert.equal(req.auth?.userId, 'regular_user');
        assert.equal(req.auth?.tenantId, 'tenant_low_priv');
        assert.deepEqual(req.auth?.roles, ['user']);
    });

    await t.test('createAuthMiddleware - Supports API Key authorization', () => {
        const middleware = createAuthMiddleware({
            jwtSecret: testSecret,
            apiKeys: {
                'api-key-secret-999': {
                    userId: 'svc-crawler',
                    tenantId: 'tenant_system',
                    roles: ['ingest_agent']
                }
            }
        });

        let nextCalled = false;
        const req = {
            headers: { 'x-api-key': 'api-key-secret-999' }
        } as unknown as Request;
        const res = {} as unknown as Response;

        middleware(req, res, () => { nextCalled = true; });

        assert.equal(nextCalled, true);
        assert.equal(req.auth?.userId, 'svc-crawler');
        assert.equal(req.auth?.tenantId, 'tenant_system');
        assert.deepEqual(req.auth?.roles, ['ingest_agent']);
    });

    await t.test('requireRoles - Enforces RBAC permissions', () => {
        const rbacGuard = requireRoles(['admin', 'editor']);

        // Case 1: Caller has required role
        let next1 = false;
        const req1 = { auth: { userId: 'u1', tenantId: 't1', roles: ['editor'] } } as Request;
        const res1 = {} as Response;
        rbacGuard(req1, res1, () => { next1 = true; });
        assert.equal(next1, true);

        // Case 2: Caller has insufficient role (Forbidden 403)
        let next2 = false;
        let status2 = 0;
        let json2: any = null;
        const req2 = { auth: { userId: 'u2', tenantId: 't1', roles: ['viewer', 'guest'] } } as Request;
        const res2 = {
            status: (code: number) => {
                status2 = code;
                return { json: (d: any) => { json2 = d; } };
            }
        } as unknown as Response;
        rbacGuard(req2, res2, () => { next2 = true; });
        assert.equal(next2, false);
        assert.equal(status2, 403);
        assert.ok(json2.error?.includes('Access denied'));

        // Case 3: Caller has no auth (Unauthorized 401)
        let next3 = false;
        let status3 = 0;
        const req3 = {} as Request;
        const res3 = {
            status: (code: number) => {
                status3 = code;
                return { json: () => {} };
            }
        } as unknown as Response;
        rbacGuard(req3, res3, () => { next3 = true; });
        assert.equal(next3, false);
        assert.equal(status3, 401);
    });
});
