import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { GovernedToolExecutor } from '../../../src/core/security/governed-tool-executor.js';
import { ConfirmationService } from '../../../src/core/security/confirmation.js';
import type { IAgentTool, ToolAuditLog } from '../../../src/interfaces/tool.interface.js';
import type { QueryContext } from '../../../src/interfaces/query-context.interface.js';

describe('P0 GovernedToolExecutor Mandatory Security Gates & Adversarial Suite', () => {
    const testSecret = 'secure-governed-tool-hmac-secret-32b';

    const sensitiveLookupTool: IAgentTool = {
        name: 'get_customer_balance',
        description: 'Read-only lookup of sensitive customer banking balance',
        isMutating: false,
        requiresConfirmation: false,
        requiredRoles: ['finance_officer', 'auditor'],
        zodSchema: z.object({
            customerId: z.string().min(3),
            currency: z.enum(['TRY', 'USD', 'EUR'])
        }),
        execute: async (args: { customerId: string; currency: string }) => {
            return { customerId: args.customerId, balance: 100_000, currency: args.currency };
        }
    };

    const fundTransferTool: IAgentTool = {
        name: 'transfer_funds',
        description: 'Mutating tool to transfer money between accounts',
        isMutating: true,
        requiresConfirmation: true,
        requiredRoles: ['finance_admin'],
        zodSchema: z.object({
            toAccount: z.string().min(5),
            amount: z.number().positive(),
            password: z.string().optional() // for testing secret redaction
        }),
        execute: async (args: { toAccount: string; amount: number; password?: string }) => {
            return { txId: 'tx_9999', transferred: true, amount: args.amount };
        }
    };

    it('Gate 1: Rejects malformed or unregistered tool definition', async () => {
        const malformedTool = { name: 'invalid tool name!' } as unknown as IAgentTool;
        const res = await GovernedToolExecutor.execute({
            tool: malformedTool,
            context: { tenantId: 'tenant_1', userId: 'user_1', roles: ['admin'] }
        });
        assert.strictEqual(res.status, 'EXECUTION_FAILED');
        assert.ok(res.error.includes('Invalid, malformed'));
    });

    it('Gate 2: Rejects missing, empty, or whitespace-only tenantId (Forged / Missing Tenant Boundary)', async () => {
        const resNoContext = await GovernedToolExecutor.execute({
            tool: sensitiveLookupTool,
            arguments: { customerId: 'cust_1', currency: 'USD' }
        });
        assert.strictEqual(resNoContext.status, 'UNAUTHORIZED');
        assert.ok(resNoContext.error.includes('tenant context is required'));

        const resEmptyTenant = await GovernedToolExecutor.execute({
            tool: sensitiveLookupTool,
            arguments: { customerId: 'cust_1', currency: 'USD' },
            context: { tenantId: '   ', userId: 'user_1' }
        });
        assert.strictEqual(resEmptyTenant.status, 'UNAUTHORIZED');
    });

    it('Gate 3: Enforces RBAC on read-only tools (Read-Only tools are not inherently safe)', async () => {
        // Caller has role 'viewer' instead of 'finance_officer'
        const res = await GovernedToolExecutor.execute({
            tool: sensitiveLookupTool,
            arguments: { customerId: 'cust_123', currency: 'USD' },
            context: { tenantId: 'corp', userId: 'unauthorized_alice', roles: ['viewer', 'support'] }
        });
        assert.strictEqual(res.status, 'UNAUTHORIZED');
        assert.ok(res.error.includes('User "unauthorized_alice" lacks required role(s)'));
    });

    it('Gate 3: Enforces RBAC on mutating tools', async () => {
        const res = await GovernedToolExecutor.execute({
            tool: fundTransferTool,
            arguments: { toAccount: 'ACC12345', amount: 500 },
            context: { tenantId: 'corp', userId: 'bob', roles: ['finance_officer'] } // lacks finance_admin
        });
        assert.strictEqual(res.status, 'UNAUTHORIZED');
        assert.ok(res.error.includes('finance_admin'));
    });

    it('Gate 4: Rejects missing required arguments when empty {} is provided (Fail-Closed Zod)', async () => {
        const res = await GovernedToolExecutor.execute({
            tool: sensitiveLookupTool,
            arguments: {}, // Empty args should fail schema with required customerId
            context: { tenantId: 'corp', userId: 'authorized_user', roles: ['finance_officer'] }
        });
        assert.strictEqual(res.status, 'VALIDATION_FAILED');
        assert.ok(res.error.includes('Argument validation failed'));
    });

    it('Gate 4: Rejects invalid argument types or constraints', async () => {
        const res = await GovernedToolExecutor.execute({
            tool: sensitiveLookupTool,
            arguments: { customerId: 'x', currency: 'INVALID_CURRENCY' }, // x < 3 chars, invalid enum
            context: { tenantId: 'corp', userId: 'authorized_user', roles: ['finance_officer'] }
        });
        assert.strictEqual(res.status, 'VALIDATION_FAILED');
        assert.ok(res.details !== undefined);
    });

    it('Gate 5: Enforces tenant-specific tool permission allowlist', async () => {
        const tenantPermissions = {
            'tenant_allowed': ['get_customer_balance'],
            'tenant_forbidden': ['other_tool']
        };

        const res = await GovernedToolExecutor.execute({
            tool: sensitiveLookupTool,
            arguments: { customerId: 'cust_999', currency: 'TRY' },
            context: { tenantId: 'tenant_forbidden', userId: 'admin', roles: ['finance_officer'] },
            tenantPermissions
        });
        assert.strictEqual(res.status, 'UNAUTHORIZED');
        assert.ok(res.error.includes('not permitted for tenant "tenant_forbidden"'));
    });

    it('Gate 6 & 7: Blocks mutating operations and issues HMAC confirmation ticket', async () => {
        const confirmationService = new ConfirmationService(testSecret);
        const context: QueryContext = { tenantId: 'corp', userId: 'cfo_bob', roles: ['finance_admin'] };

        const res = await GovernedToolExecutor.execute({
            tool: fundTransferTool,
            arguments: { toAccount: 'ACC98765', amount: 1500 },
            context,
            confirmationService,
            confirmationSecret: testSecret
        });

        assert.strictEqual(res.status, 'CONFIRMATION_REQUIRED');
        assert.ok(res.confirmationTicket);
        assert.ok(res.confirmationTicket.length > 20);
        assert.deepStrictEqual(res.proposedArgs, { toAccount: 'ACC98765', amount: 1500 });
    });

    it('Gate 7 & 8: Successfully executes mutating tool with valid confirmation ticket and rejects replay attack', async () => {
        const confirmationService = new ConfirmationService(testSecret);
        const context: QueryContext = { tenantId: 'corp', userId: 'cfo_bob', roles: ['finance_admin'] };
        const validArgs = { toAccount: 'ACC98765', amount: 1500 };

        // 1. Issue ticket
        const ticket = confirmationService.issueTicket('transfer_funds', validArgs, context);

        // 2. Execute with ticket
        const res = await GovernedToolExecutor.execute({
            tool: fundTransferTool,
            arguments: validArgs,
            context: { ...context, confirmationTicket: ticket },
            confirmationService,
            confirmationSecret: testSecret
        });

        assert.strictEqual(res.status, 'SUCCESS');
        assert.deepStrictEqual(res.data, { txId: 'tx_9999', transferred: true, amount: 1500 });

        // 3. Replay attack: attempt to use the exact same ticket again
        const replayRes = await GovernedToolExecutor.execute({
            tool: fundTransferTool,
            arguments: validArgs,
            context: { ...context, confirmationTicket: ticket },
            confirmationService,
            confirmationSecret: testSecret
        });

        // Replay must be blocked and a fresh ticket issued
        assert.strictEqual(replayRes.status, 'CONFIRMATION_REQUIRED');
    });

    it('Gate 7: Rejects cross-tenant confirmation ticket redemption', async () => {
        const confirmationService = new ConfirmationService(testSecret);
        const validArgs = { toAccount: 'ACC98765', amount: 1500 };

        // Issued for tenant_alpha
        const ticket = confirmationService.issueTicket('transfer_funds', validArgs, {
            tenantId: 'tenant_alpha',
            userId: 'cfo_bob',
            roles: ['finance_admin']
        });

        // Attempt redemption under tenant_beta
        const res = await GovernedToolExecutor.execute({
            tool: fundTransferTool,
            arguments: validArgs,
            context: {
                tenantId: 'tenant_beta', // Attacker tenant
                userId: 'cfo_bob',
                roles: ['finance_admin'],
                confirmationTicket: ticket
            },
            confirmationService,
            confirmationSecret: testSecret
        });

        assert.strictEqual(res.status, 'CONFIRMATION_REQUIRED');
    });

    it('Gate 9: Enforces cancellation before execution when signal is already aborted', async () => {
        const abortController = new AbortController();
        abortController.abort(new Error('Caller cancelled query'));

        const res = await GovernedToolExecutor.execute({
            tool: sensitiveLookupTool,
            arguments: { customerId: 'cust_001', currency: 'TRY' },
            context: { tenantId: 'corp', userId: 'user', roles: ['finance_officer'] },
            signal: abortController.signal
        });

        assert.strictEqual(res.status, 'CANCELLED');
        assert.ok(res.error.includes('Caller cancelled query'));
    });

    it('Gate 9: Enforces execution timeout when tool hangs', async () => {
        const hangingTool: IAgentTool = {
            name: 'hanging_weather_api',
            description: 'Simulates unresponsive external third party API',
            isMutating: false,
            execute: async () => {
                await new Promise(resolve => setTimeout(resolve, 500));
                return { weather: 'sunny' };
            }
        };

        const res = await GovernedToolExecutor.execute({
            tool: hangingTool,
            arguments: {},
            context: { tenantId: 'corp', userId: 'user', roles: [] },
            timeoutMs: 50 // very small timeout to trigger Gate 9
        });

        assert.strictEqual(res.status, 'TIMEOUT');
        assert.ok(res.error.includes('timed out'));
    });

    it('Gate 10: Records security audit log and redacts sensitive credentials/secrets', async () => {
        const auditLogs: ToolAuditLog[] = [];

        await GovernedToolExecutor.execute({
            tool: fundTransferTool,
            arguments: {
                toAccount: 'ACC12345',
                amount: 50,
                password: 'super_secret_cleartext_password'
            },
            context: { tenantId: 'corp', userId: 'test_user', roles: ['finance_admin'] },
            confirmationSecret: testSecret,
            auditRecorder: (log) => { auditLogs.push(log); }
        });

        assert.strictEqual(auditLogs.length, 1);
        const log = auditLogs[0]!;
        assert.strictEqual(log.status, 'CONFIRMATION_REQUIRED');
        const loggedArgs = log.args as Record<string, unknown>;
        assert.strictEqual(loggedArgs['password'], '[REDACTED]');
        assert.strictEqual(loggedArgs['toAccount'], 'ACC12345');
    });
});
