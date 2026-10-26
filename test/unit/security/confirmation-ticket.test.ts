import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfirmationService } from '../../../src/core/security/confirmation';
import { RAGEngine } from '../../../src/core/engine';
import { z } from 'zod';
import type { ILLMProvider, ILLMRequest, ILLMResponse } from '../../../src/interfaces/llm.interface';

class MockLLMProvider implements ILLMProvider {
    async generate(req: ILLMRequest): Promise<ILLMResponse> {
        return {
            content: 'LLM Response',
            usage: { promptTokens: 10, completionTokens: 5 }
        };
    }
}

test('Security Layer - Cryptographic Mutation Confirmation Tickets', async (t) => {
    const confirmationService = new ConfirmationService('test-secret-salt-for-tickets');

    await t.test('Canonicalize & Hash - Deterministic sorting across arbitrary key order', async () => {
        const args1 = { sku: 'PROD-1', quantity: 10, meta: { tags: ['a', 'b'], active: true } };
        const args2 = { meta: { active: true, tags: ['a', 'b'] }, quantity: 10, sku: 'PROD-1' };

        const hash1 = ConfirmationService.hashArgs(args1);
        const hash2 = ConfirmationService.hashArgs(args2);

        assert.equal(hash1, hash2, 'Arg hashes must be completely deterministic regardless of object key order');
    });

    await t.test('issueTicket & verifyTicket - Valid round-trip execution', async () => {
        const ticket = confirmationService.issueTicket({
            toolName: 'delete_user_account',
            args: { userId: 'usr_123', cascade: true },
            tenantId: 'tenant_alpha'
        });

        assert.ok(typeof ticket === 'string');

        // Verify valid ticket
        const verification = await confirmationService.verifyTicket(ticket, {
            toolName: 'delete_user_account',
            args: { userId: 'usr_123', cascade: true },
            tenantId: 'tenant_alpha'
        });

        assert.equal(verification.valid, true);
    });

    await t.test('verifyTicket - Rejects tampered arguments (Parameter Tampering Defense)', async () => {
        const ticket = confirmationService.issueTicket({
            toolName: 'transfer_credits',
            args: { recipient: 'bob', amount: 50 },
            tenantId: 'tenant_alpha'
        });

        // Attacker attempts to change amount from 50 to 50000 using the same ticket
        await assert.rejects(async () => {
            await confirmationService.verifyTicket(ticket, {
                toolName: 'transfer_credits',
                args: { recipient: 'bob', amount: 50000 },
                tenantId: 'tenant_alpha'
            });
        }, /Ticket argument mismatch/);
    });

    await t.test('verifyTicket - Rejects tool alteration', async () => {
        const ticket = confirmationService.issueTicket({
            toolName: 'read_logs',
            args: { scope: 'all' },
            tenantId: 'tenant_alpha'
        });

        // Attacker tries to use read ticket for delete tool
        await assert.rejects(async () => {
            await confirmationService.verifyTicket(ticket, {
                toolName: 'delete_logs',
                args: { scope: 'all' },
                tenantId: 'tenant_alpha'
            });
        }, /Ticket tool mismatch/);
    });

    await t.test('verifyTicket - Rejects cross-tenant ticket redemption (Tenant Isolation)', async () => {
        const ticket = confirmationService.issueTicket({
            toolName: 'purge_cache',
            args: {},
            tenantId: 'tenant_victim'
        });

        // Attacker in tenant_attacker tries to redeem victim's confirmation ticket
        await assert.rejects(async () => {
            await confirmationService.verifyTicket(ticket, {
                toolName: 'purge_cache',
                args: {},
                tenantId: 'tenant_attacker'
            });
        }, /Ticket tenant mismatch/);
    });

    await t.test('verifyTicket - Replay Attack Defense (Single-Use Nonce)', async () => {
        const ticket = confirmationService.issueTicket({
            toolName: 'pay_invoice',
            args: { invoiceId: 'INV-99' },
            tenantId: 'tenant_acme'
        });

        // 1st redemption: Succeeds
        const res1 = await confirmationService.verifyTicket(ticket, {
            toolName: 'pay_invoice',
            args: { invoiceId: 'INV-99' },
            tenantId: 'tenant_acme'
        });
        assert.equal(res1.valid, true);

        // 2nd redemption (Replay attempt): MUST FAIL immediately
        await assert.rejects(async () => {
            await confirmationService.verifyTicket(ticket, {
                toolName: 'pay_invoice',
                args: { invoiceId: 'INV-99' },
                tenantId: 'tenant_acme'
            });
        }, /Ticket nonce has already been consumed/);
    });

    await t.test('End-to-End RAGEngine: Barrier 2 mutation gate with confirmation ticket flow', async () => {
        let executionCount = 0;

        class MockExtractionLLM implements ILLMProvider {
            async generate(req: ILLMRequest): Promise<ILLMResponse> {
                if (req.tools && req.tools.length > 0) {
                    return {
                        content: 'Simulated tool extraction',
                        toolCalls: [{ name: req.tools[0]!.name, arguments: { nodeId: 'node-5' } }]
                    };
                }
                return { content: 'Tool execution completed.' };
            }
        }

        const restartTool = {
            name: 'restart_cluster_node',
            description: 'Restarts a production cluster node in datacenter',
            requiredRoles: ['admin'],
            zodSchema: z.object({
                nodeId: z.string().min(1)
            }),
            isMutating: true,
            execute: async ({ nodeId }: { nodeId: string }) => {
                executionCount++;
                return { restarted: nodeId, status: 'ok' };
            }
        };

        const engine = new RAGEngine({
            llmProvider: new MockExtractionLLM(),
            cache: { enabled: true, cacheToolResults: true },
            tools: {
                registryFilePath: './data/test-confirmation-tools.json',
                items: [restartTool]
            },
            smlConfig: { enabled: true, matchThreshold: 0.35 }
        });

        await engine.init();

        const userContext = {
            userId: 'admin_usr',
            roles: ['admin'],
            tenantId: 'tenant_prod'
        };

        // 1. Initial query without confirmation ticket -> Barrier 2 blocks mutation
        const proposal = await engine.query('Please restart cluster node in datacenter', userContext);
        assert.equal(executionCount, 0, 'Mutating tool must NOT execute without verified ticket');

        await engine.query('Please restart cluster node in datacenter', { ...userContext, confirmedAction: true });
        assert.equal(executionCount, 0, 'Boolean confirmation must never bypass the signed ticket');

        const auditLogs = engine.getAuditLogs('tenant_prod');
        const lastLog = auditLogs[auditLogs.length - 1];
        assert.equal(lastLog?.status, 'CONFIRMATION_REQUIRED');

        // 2. Redeem the structured proposal returned by the engine.
        const validTicket = proposal.confirmationRequests![0]!.confirmationTicket;
        assert.equal(proposal.confirmationRequests![0]!.toolName, 'restart_cluster_node');

        // 3. Query with valid ticket -> Should execute successfully
        await engine.query('Please restart cluster node in datacenter', {
            ...userContext,
            confirmationTicket: validTicket
        });

        assert.equal(executionCount, 1, 'Tool should have executed exactly once');
        const successLog = engine.getAuditLogs('tenant_prod').slice(-1)[0];
        assert.equal(successLog?.status, 'SUCCESS');

        // 4. Attempting to replay the exact same ticket -> Anti-replay single-use nonce blocks execution
        await engine.query('Please restart cluster node in datacenter', {
            ...userContext,
            confirmationTicket: validTicket
        });

        assert.equal(executionCount, 1, 'Replay attempt must not execute tool again');
        assert.equal(engine.getAuditLogs('tenant_prod').length, 4, 'Mutating attempts must never be served from cache');
        const replayLog = engine.getAuditLogs('tenant_prod').slice(-1)[0];
        assert.equal(replayLog?.status, 'CONFIRMATION_REQUIRED');
    });
});
