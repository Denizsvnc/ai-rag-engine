import { ConfirmationService } from '../../src/core/security/confirmation';
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { z } from 'zod';
import { RAGEngine } from '../../src/core/engine';
import type { IAgentTool } from '../../src/interfaces/tool.interface';
import type { ILLMProvider, ILLMRequest, ILLMResponse } from '../../src/interfaces/llm.interface';

// Mock LLM configured to simulate extracting tool arguments
class MockExtractionLLM implements ILLMProvider {
    constructor(private simulatedArgs: any, private simulatedToolName?: string) {}

    async generate(req: ILLMRequest): Promise<ILLMResponse> {
        // If tools are present, simulate LLM choosing to call tool
        if (req.tools && req.tools.length > 0) {
            return {
                content: 'Simulated extraction',
                toolCalls: [
                    {
                        name: this.simulatedToolName ?? req.tools[0]!.name,
                        arguments: this.simulatedArgs
                    }
                ]
            };
        }
        return { content: 'Final response after tool execution.' };
    }
}

describe('Governed Tool Execution - RBAC, Zod & Mutation Guard', () => {
    const updateInventoryTool: IAgentTool = {
        name: 'update_inventory_stock',
        description: 'Updates product stock inventory in the warehouse database.',
        isMutating: true,
        requiredRoles: ['inventory_admin', 'warehouse_lead'],
        zodSchema: z.object({
            sku: z.string().min(3),
            quantity: z.number().int().nonnegative()
        }),
        execute: async (args: { sku: string; quantity: number }) => {
            return { success: true, updatedSku: args.sku, newQty: args.quantity };
        }
    };

    test('Barrier 1: Should block tool execution when user lacks required RBAC role', async () => {
        const mockLLM = new MockExtractionLLM({ sku: 'LAPTOP-X1', quantity: 25 });
        const engine = new RAGEngine({
            llmProvider: mockLLM,
            inputs: {},
            tools: {
                registryFilePath: './data/test-gov-tools.json',
                items: [updateInventoryTool]
            },
            smlConfig: { enabled: true, matchThreshold: 0.35 }
        });

        await engine.init();

        // Caller is a standard customer with no inventory_admin role
        const response = await engine.query('Please update product stock inventory in the warehouse database for LAPTOP-X1', {
            tenantId: 'tenant_corp',
            userId: 'cust_101',
            roles: ['customer', 'guest'],
            confirmedAction: true
        });

        const auditLogs = engine.getAuditLogs();
        assert.ok(auditLogs.length > 0);
        const lastAudit = auditLogs[auditLogs.length - 1];
        assert.strictEqual(lastAudit?.status, 'UNAUTHORIZED');
        assert.ok(lastAudit?.error?.includes('inventory_admin'));
    });

    test('Barrier 2: Should block mutating tool when confirmedAction is missing/false', async () => {
        const mockLLM = new MockExtractionLLM({ sku: 'LAPTOP-X1', quantity: 25 });
        const engine = new RAGEngine({
            llmProvider: mockLLM,
            inputs: {},
            tools: {
                registryFilePath: './data/test-gov-tools.json',
                items: [updateInventoryTool]
            },
            smlConfig: { enabled: true, matchThreshold: 0.35 }
        });

        await engine.init();

        // Caller has role but has NOT explicitly confirmed action
        const response = await engine.query('Can I update product stock inventory in the warehouse database for LAPTOP-X1?', {
            tenantId: 'tenant_corp',
            userId: 'admin_1',
            roles: ['inventory_admin'],
            confirmedAction: false
        });

        const auditLogs = engine.getAuditLogs();
        const lastAudit = auditLogs[auditLogs.length - 1];
        assert.strictEqual(lastAudit?.status, 'CONFIRMATION_REQUIRED');
    });

    test('Barrier 3: Should block tool execution when arguments fail Zod schema validation', async () => {
        // Invalid arguments: quantity is negative (-5) and sku is too short ('A')
        const mockLLM = new MockExtractionLLM({ sku: 'A', quantity: -5 });
        const engine = new RAGEngine({
            llmProvider: mockLLM,
            inputs: {},
            tools: {
                registryFilePath: './data/test-gov-tools.json',
                items: [updateInventoryTool]
            },
            smlConfig: { enabled: true, matchThreshold: 0.35 }
        });

        await engine.init();

        const response = await engine.query('Please update product stock inventory in the warehouse database with bad params', {
            tenantId: 'tenant_corp',
            userId: 'admin_1',
            roles: ['inventory_admin'],
            confirmationTicket: ConfirmationService.issueTicket(updateInventoryTool.name, { sku: 'A', quantity: -5 }, { tenantId: 'tenant_corp', userId: 'admin_1' })
        });

        const auditLogs = engine.getAuditLogs();
        const lastAudit = auditLogs[auditLogs.length - 1];
        assert.strictEqual(lastAudit?.status, 'VALIDATION_FAILED');
        assert.ok(lastAudit?.error?.includes('Invalid tool arguments'));
    });

    test('Barrier 4: Should successfully execute tool and record SUCCESS in audit log when all barriers pass', async () => {
        const mockLLM = new MockExtractionLLM({ sku: 'LAPTOP-X1', quantity: 42 });
        const engine = new RAGEngine({
            llmProvider: mockLLM,
            inputs: {},
            tools: {
                registryFilePath: './data/test-gov-tools.json',
                items: [updateInventoryTool]
            },
            smlConfig: { enabled: true, matchThreshold: 0.35 }
        });

        await engine.init();

        const response = await engine.query('Please update product stock inventory in the warehouse database for LAPTOP-X1 to 42', {
            tenantId: 'tenant_corp',
            userId: 'admin_1',
            roles: ['inventory_admin'],
            confirmationTicket: ConfirmationService.issueTicket(updateInventoryTool.name, { sku: 'LAPTOP-X1', quantity: 42 }, { tenantId: 'tenant_corp', userId: 'admin_1' })
        });

        const auditLogs = engine.getAuditLogs();
        const lastAudit = auditLogs[auditLogs.length - 1];
        assert.strictEqual(lastAudit?.status, 'SUCCESS');
        assert.strictEqual(lastAudit?.isMutating, true);
        assert.strictEqual(lastAudit?.args.sku, 'LAPTOP-X1');
        assert.strictEqual(lastAudit?.args.quantity, 42);
    });
    test('Extraction must not redeem approval for a different tool name', async () => {
        let executions = 0;
        const args = { sku: 'LAPTOP-X1', quantity: 42 };
        const engine = new RAGEngine({
            llmProvider: new MockExtractionLLM(args, 'read_inventory'), inputs: {},
            cache: { enabled: false },
            tools: { registryFilePath: './data/test-gov-tools.json', items: [{
                ...updateInventoryTool, execute: async () => { executions++; return {}; }
            }] },
            smlConfig: { enabled: true, matchThreshold: 0.35 }
        });
        await engine.init();
        const context = { tenantId: 'tenant_corp', userId: 'admin_1', roles: ['inventory_admin'] };
        await engine.query('Please update product stock inventory in the warehouse database', {
            ...context, confirmationTicket: ConfirmationService.issueTicket('read_inventory', args, context)
        });
        assert.equal(executions, 0);
        assert.equal(engine.getAuditLogs().at(-1)?.status, 'VALIDATION_FAILED');
    });

});
