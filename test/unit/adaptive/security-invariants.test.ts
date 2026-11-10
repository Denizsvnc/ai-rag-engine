import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StrategyRegistry } from '../../../src/core/adaptive/strategy-registry.js';
import { MemoryGraphAdapter } from '../../../src/adapters/graph/memory-graph.adapter.js';
import { AgenticRAGStrategy } from '../../../src/core/adaptive/strategies/agentic-rag.strategy.js';
import { AdaptiveQueryPlanner } from '../../../src/core/adaptive/query-planner.js';
import type { ToolRegistry } from '../../../src/core/tool-registry.js';

describe('Adaptive Architecture Security Invariants & Multi-Tenancy', () => {
    it('prevents caller from requesting a strategy disabled by system config', async () => {
        const registry = new StrategyRegistry({
            enabled: true,
            mode: 'auto',
            strategies: {
                agentic_rag: false // System admin disabled agentic_rag
            }
        });

        // Caller attempts to force agentic_rag via context override
        const isPermitted = registry.isStrategyPermitted('agentic_rag', 'agentic_rag');
        assert.strictEqual(isPermitted, false);
    });

    it('enforces strict graph multi-tenancy: node neighbor search never leaks across tenants', async () => {
        const graph = new MemoryGraphAdapter();

        // Tenant 1 node
        await graph.addNodes([
            { id: 'node_financial_t1', tenantId: 'tenant-1', name: 'Q4 Financials', type: 'document', confidence: 1.0 }
        ]);

        // Tenant 2 node
        await graph.addNodes([
            { id: 'node_financial_t2', tenantId: 'tenant-2', name: 'Q4 Financials', type: 'document', confidence: 1.0 }
        ]);

        // Tenant 1 traverses
        const neighborsT1 = await graph.getNeighbors('node_financial_t1', 'tenant-1');
        assert.ok(neighborsT1.nodes.every(n => n.tenantId === 'tenant-1'));

        // Tenant 2 traverses tenant-1's node id
        const leaked = await graph.getNeighbors('node_financial_t1', 'tenant-2');
        assert.strictEqual(leaked.nodes.length, 0);
        assert.strictEqual(leaked.edges.length, 0);
    });

    it('blocks mutating tool execution in Agentic RAG without cryptographic confirmation ticket', async () => {
        let executedMutatingAction = false;

        const mutatingTool = {
            name: 'delete_customer_record',
            description: 'Permanently deletes customer record',
            isMutating: true,
            requiresConfirmation: true,
            execute: async () => {
                executedMutatingAction = true;
                return { status: 'deleted' };
            }
        };

        const mockRegistry = {
            getAllTools: () => [mutatingTool],
            routeQueryToTool: async () => mutatingTool
        } as unknown as ToolRegistry;

        const agentic = new AgenticRAGStrategy(mockRegistry, true);
        const res = await agentic.execute({
            query: 'delete_customer_record for user 1234',
            tenantId: 'tenant-secure'
        });

        // The mutating action MUST NOT execute automatically
        assert.strictEqual(executedMutatingAction, false);
        assert.strictEqual(res.success, true);

        // Mutating action requirement must be recorded as pending evidence
        const blockedEvidence = res.evidence.find(e => e.sourceDocId === 'tool_delete_customer_record');
        assert.ok(blockedEvidence);
        assert.ok(blockedEvidence.content.includes('confirmation'));
    });
});

