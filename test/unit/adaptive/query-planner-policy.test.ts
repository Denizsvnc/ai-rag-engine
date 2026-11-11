import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveQueryPlanner } from '../../../src/core/adaptive/query-planner.js';
import { StrategyRegistry } from '../../../src/core/adaptive/strategy-registry.js';
import type { IStrategy, StrategyId } from '../../../src/interfaces/strategy.interface.js';

function createMockStrat(id: StrategyId, enabled = true): IStrategy {
    return {
        metadata: {
            id,
            name: String(id),
            description: '',
            category: 'retrieval',
            supportsStreaming: false,
            supportsMultiTenant: true,
            requiresGraphIndex: false,
            requiresVectorStore: false,
            requiresToolRegistry: false,
            typicalLatencyMs: 20,
            estimatedCostPerQuery: 0.001
        },
        isEnabled: () => enabled,
        isAvailable: async () => enabled,
        estimateCost: () => 0.001,
        estimateLatency: () => 20,
        execute: async () => ({
            strategyId: id,
            success: true,
            executionTimeMs: 5,
            evidence: [],
            confidence: 0.9
        })
    };
}

describe('AdaptiveQueryPlanner Policy & Override Enforcement (Phase 7)', () => {
    it('ignores caller request overrides when allowRequestOverrides is false', async () => {
        const registry = new StrategyRegistry();
        registry.register(createMockStrat('hybrid_search'));
        registry.register(createMockStrat('semantic_search'));

        const planner = new AdaptiveQueryPlanner({
            enabled: true,
            mode: 'auto',
            allowRequestOverrides: false
        }, registry);

        const decision = await planner.plan({
            query: 'standard query',
            tenantId: 'tenant-1',
            metadata: {
                requestedMode: 'manual',
                requestedStrategy: 'semantic_search'
            }
        });

        // Mode must remain 'auto', not caller-requested 'manual'
        assert.equal(decision.mode, 'auto');
        assert.ok(decision.reasons.some(r => r.includes('Request overrides disabled')));
    });

    it('rejects manual request for disabled strategy and enforces tenant policy', async () => {
        const registry = new StrategyRegistry();
        registry.register(createMockStrat('agentic_rag', false)); // Disabled
        registry.register(createMockStrat('hybrid_search', true));

        const planner = new AdaptiveQueryPlanner({
            enabled: true,
            mode: 'manual',
            allowRequestOverrides: true,
            strategies: {
                agentic_rag: false // Explicitly disabled
            }
        }, registry);

        const decision = await planner.plan({
            query: 'update my record',
            tenantId: 'tenant-1',
            metadata: {
                requestedStrategy: 'agentic_rag'
            }
        });

        // agentic_rag must be in rejectedStrategies and NOT in selectedStrategies
        assert.ok(!decision.selectedStrategies.includes('agentic_rag'));
        assert.ok(decision.rejectedStrategies.some(r => r.strategyId === 'agentic_rag'));
        assert.ok(decision.selectedStrategies.includes('hybrid_search'));
    });

    it('calibrates confidence honestly based on signal type', async () => {
        const registry = new StrategyRegistry();
        registry.register(createMockStrat('hybrid_search'));
        registry.register(createMockStrat('kag'));
        registry.register(createMockStrat('semantic_search'));

        const planner = new AdaptiveQueryPlanner({ enabled: true, mode: 'auto' }, registry);

        // Exact ID query
        const exactDec = await planner.plan({
            query: 'SKU-12345 nolu ürün',
            tenantId: 'tenant-1'
        });
        assert.equal(exactDec.confidence, 0.95);

        // Logic compliance query
        const logicDec = await planner.plan({
            query: 'Bu işlem şirket kurallarına uygun mu?',
            tenantId: 'tenant-1'
        });
        assert.equal(logicDec.confidence, 0.90);

        // Generic fallback query without specific signals
        const genericDec = await planner.plan({
            query: 'hava durumu',
            tenantId: 'tenant-1'
        });
        assert.equal(genericDec.confidence, 0.70);
    });
});
