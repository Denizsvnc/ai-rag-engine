import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { RAGEngine } from '../../../src/core/engine';
import { createApiRoutes } from '../../../src/api/routes';
import { createAuthToken } from '../../../src/api/auth';
import type { ILLMProvider, ILLMRequest, ILLMResponse } from '../../../src/interfaces/llm.interface';

class MockLLMProvider implements ILLMProvider {
    async generate(req: ILLMRequest): Promise<ILLMResponse> {
        return {
            content: 'Mock response',
            usage: { promptTokens: 5, completionTokens: 5 }
        };
    }
}

test('Security Layer - Protected Administrative Endpoints & Tenant Audit Scoping', async (t) => {
    const testSecret = 'production-grade-api-test-secret-key-32b';
    const engine = new RAGEngine({
        llmProvider: new MockLLMProvider(),
        cache: { enabled: false },
        smlConfig: { enabled: false }
    });
    await engine.init();

    // Populate engine with mock audit logs from two different tenants
    engine.recordAuditLog({
        timestamp: new Date().toISOString(),
        toolName: 'action_alpha',
        tenantId: 'tenant_alpha',
        userId: 'alice',
        args: { scope: 'read' },
        isMutating: false,
        status: 'SUCCESS',
        durationMs: 10
    });

    engine.recordAuditLog({
        timestamp: new Date().toISOString(),
        toolName: 'action_beta',
        tenantId: 'tenant_beta',
        userId: 'bob',
        args: { scope: 'read' },
        isMutating: false,
        status: 'SUCCESS',
        durationMs: 12
    });

    // Create app with enforced authentication
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRoutes(engine, {
        enforceAuth: true,
        auth: { jwtSecret: testSecret, allowDevAnonymous: false }
    }));

    const server = app.listen(0);
    const port = (server.address() as any).port;
    const baseUrl = `http://127.0.0.1:${port}/api`;

    const userTokenAlpha = createAuthToken({
        userId: 'alice',
        tenantId: 'tenant_alpha',
        roles: ['user']
    }, testSecret);

    const auditorTokenAlpha = createAuthToken({
        userId: 'auditor_a',
        tenantId: 'tenant_alpha',
        roles: ['auditor']
    }, testSecret);

    const superAdminToken = createAuthToken({
        userId: 'super_admin',
        tenantId: 'internal_ops',
        roles: ['superadmin', 'admin']
    }, testSecret);

    try {
        await t.test('GET /api/audit - Rejects unauthenticated caller with 401', async () => {
            const res = await fetch(`${baseUrl}/audit`);
            assert.equal(res.status, 401);
        });

        await t.test('GET /api/audit - Rejects unauthorized caller (user role) with 403', async () => {
            const res = await fetch(`${baseUrl}/audit`, {
                headers: { 'Authorization': `Bearer ${userTokenAlpha}` }
            });
            assert.equal(res.status, 403);
            const body = await res.json() as any;
            assert.ok(body.error?.includes('Access denied'));
        });

        await t.test('GET /api/audit - Scopes audit logs strictly to caller tenantId', async () => {
            const res = await fetch(`${baseUrl}/audit`, {
                headers: { 'Authorization': `Bearer ${auditorTokenAlpha}` }
            });
            assert.equal(res.status, 200);
            const logs = await res.json() as any[];
            assert.ok(Array.isArray(logs));
            // All logs returned must belong exclusively to tenant_alpha
            assert.ok(logs.every(log => log.tenantId === 'tenant_alpha'));
            assert.ok(!logs.some(log => log.tenantId === 'tenant_beta'), 'Must NOT leak tenant_beta audit logs');
        });

        await t.test('GET /api/audit - Superadmin can view global audit logs across all tenants', async () => {
            const res = await fetch(`${baseUrl}/audit`, {
                headers: { 'Authorization': `Bearer ${superAdminToken}` }
            });
            assert.equal(res.status, 200);
            const logs = await res.json() as any[];
            assert.ok(Array.isArray(logs));
            // Superadmin has access to both tenant_alpha and tenant_beta logs
            const tenantIds = new Set(logs.map(l => l.tenantId));
            assert.ok(tenantIds.has('tenant_alpha'));
            assert.ok(tenantIds.has('tenant_beta'));
        });

        await t.test('POST /api/ingest - Rejects unauthenticated caller with 401', async () => {
            const res = await fetch(`${baseUrl}/ingest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: 'doc.txt', content: 'test' })
            });
            assert.equal(res.status, 401);
        });

        await t.test('POST /api/ingest - Rejects caller lacking ingest_agent or editor role with 403', async () => {
            const res = await fetch(`${baseUrl}/ingest`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${userTokenAlpha}`
                },
                body: JSON.stringify({ filename: 'doc.txt', content: 'test' })
            });
            assert.equal(res.status, 403);
        });

        await t.test('GET /api/health - Remains public without authentication', async () => {
            const res = await fetch(`${baseUrl}/health`);
            assert.equal(res.status, 200);
            const body = await res.json() as any;
            assert.equal(body.status, 'ok');
        });
    } finally {
        server.close();
    }
});
