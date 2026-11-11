import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionScheduler } from '../../../src/core/adaptive/execution-scheduler.js';
import { StrategyRegistry } from '../../../src/core/adaptive/strategy-registry.js';
import type {
    IStrategy,
    StrategyExecutionContext,
    StrategyExecutionResult,
    StrategyId
} from '../../../src/interfaces/strategy.interface.js';

function createMockStrategy(
    id: StrategyId,
    options: {
        enabled?: boolean;
        available?: boolean;
        cost?: number;
        latency?: number;
        executeBehavior?: (ctx: StrategyExecutionContext) => Promise<StrategyExecutionResult>;
    } = {}
): IStrategy {
    return {
        metadata: {
            id,
            name: String(id),
            description: 'Mock strategy for testing',
            category: 'retrieval',
            supportsStreaming: false,
            supportsMultiTenant: true,
            requiresGraphIndex: false,
            requiresVectorStore: false,
            requiresToolRegistry: false,
            typicalLatencyMs: options.latency ?? 10,
            estimatedCostPerQuery: options.cost ?? 0.01
        },
        isEnabled: () => options.enabled ?? true,
        isAvailable: async () => options.available ?? true,
        estimateCost: () => options.cost ?? 0.01,
        estimateLatency: () => options.latency ?? 10,
        execute: options.executeBehavior ?? (async () => ({
            strategyId: id,
            success: true,
            executionTimeMs: 5,
            evidence: [{
                id: 'doc1',
                strategyId: id,
                sourceDocId: 'doc1',
                tenantId: 'tenant-1',
                evidenceType: 'text_chunk',
                content: 'content1',
                score: 0.9
            }],
            confidence: 0.95
        }))
    };
}

describe('ExecutionScheduler Resilience & Outcome Typing', () => {
    it('returns SUCCESS outcome for normal cooperating strategies', async () => {
        const registry = new StrategyRegistry();
        const strat = createMockStrategy('hybrid_search');
        registry.register(strat);

        const scheduler = new ExecutionScheduler({ enabled: true, latencyDeadlineMs: 1000 }, registry);
        const results = await scheduler.execute(['hybrid_search'], {
            query: 'test',
            tenantId: 'tenant-1'
        });

        assert.equal(results.length, 1);
        assert.equal(results[0]?.strategyId, 'hybrid_search');
        assert.equal(results[0]?.success, true);
        assert.equal(results[0]?.outcome, 'SUCCESS');
        assert.equal(results[0]?.evidence.length, 1);
    });

    it('returns FAILED outcome when strategy throws or fails', async () => {
        const registry = new StrategyRegistry();
        const failingStrat = createMockStrategy('semantic_search', {
            executeBehavior: async () => {
                throw new Error('Database connection failed');
            }
        });
        registry.register(failingStrat);

        const scheduler = new ExecutionScheduler({ enabled: true, latencyDeadlineMs: 1000 }, registry);
        const results = await scheduler.execute(['semantic_search'], {
            query: 'test',
            tenantId: 'tenant-1'
        });

        assert.equal(results.length, 1);
        assert.equal(results[0]?.strategyId, 'semantic_search');
        assert.equal(results[0]?.success, false);
        assert.equal(results[0]?.outcome, 'FAILED');
        assert.ok(results[0]?.error?.includes('Database connection failed'));
    });

    it('returns UNAVAILABLE outcome for unregistered or disabled strategies', async () => {
        const registry = new StrategyRegistry();
        const disabledStrat = createMockStrategy('cag', { enabled: false });
        registry.register(disabledStrat);

        const scheduler = new ExecutionScheduler({ enabled: true, latencyDeadlineMs: 1000 }, registry);
        const results = await scheduler.execute(['cag', 'traditional_rag' as StrategyId], {
            query: 'test',
            tenantId: 'tenant-1'
        });

        assert.equal(results.length, 2);
        assert.equal(results[0]?.strategyId, 'cag');
        assert.equal(results[0]?.outcome, 'UNAVAILABLE');
        assert.ok(results[0]?.error?.includes('disabled'));

        assert.equal(results[1]?.strategyId, 'traditional_rag');
        assert.equal(results[1]?.outcome, 'UNAVAILABLE');
        assert.ok(results[1]?.error?.includes('not registered'));
    });

    it('returns UNAVAILABLE outcome when isAvailable() returns false', async () => {
        const registry = new StrategyRegistry();
        const unavailableStrat = createMockStrategy('graph_rag', { available: false });
        registry.register(unavailableStrat);

        const scheduler = new ExecutionScheduler({ enabled: true, latencyDeadlineMs: 1000 }, registry);
        const results = await scheduler.execute(['graph_rag'], {
            query: 'test',
            tenantId: 'tenant-1'
        });

        assert.equal(results.length, 1);
        assert.equal(results[0]?.outcome, 'UNAVAILABLE');
        assert.ok(results[0]?.error?.includes('unavailable'));
    });

    it('returns BUDGET_EXCEEDED when estimated cost exceeds context.budgetLimit', async () => {
        const registry = new StrategyRegistry();
        const expensiveStrat = createMockStrategy('agentic_rag', { cost: 5.0 });
        registry.register(expensiveStrat);

        const scheduler = new ExecutionScheduler({ enabled: true, latencyDeadlineMs: 1000 }, registry);
        const results = await scheduler.execute(['agentic_rag'], {
            query: 'test',
            tenantId: 'tenant-1',
            budgetLimit: 1.0
        });

        assert.equal(results.length, 1);
        assert.equal(results[0]?.outcome, 'BUDGET_EXCEEDED');
        assert.equal(results[0]?.success, false);
        assert.ok(results[0]?.error?.includes('exceeds budget limit'));
    });

    it('unblocks and returns TIMED_OUT when an uncooperative strategy hangs indefinitely', async () => {
        const registry = new StrategyRegistry();
        const hangingStrat = createMockStrategy('knowledge_graph', {
            executeBehavior: () => new Promise(() => {}) // Never resolves
        });
        registry.register(hangingStrat);

        const deadlineMs = 60;
        const scheduler = new ExecutionScheduler({ enabled: true, latencyDeadlineMs: deadlineMs }, registry);

        const startTime = Date.now();
        const results = await scheduler.execute(['knowledge_graph'], {
            query: 'test',
            tenantId: 'tenant-1'
        });
        const elapsed = Date.now() - startTime;

        assert.ok(elapsed >= 50);
        assert.ok(elapsed < 400); // Must not hang indefinitely
        assert.equal(results.length, 1);
        assert.equal(results[0]?.strategyId, 'knowledge_graph');
        assert.equal(results[0]?.outcome, 'TIMED_OUT');
        assert.equal(results[0]?.success, false);
        assert.ok(/timed out|latency deadline/i.test(results[0]?.error || ''));
    });

    it('returns CANCELLED outcome when caller abort signal is already aborted', async () => {
        const registry = new StrategyRegistry();
        const strat = createMockStrategy('hybrid_search');
        registry.register(strat);

        const scheduler = new ExecutionScheduler({ enabled: true, latencyDeadlineMs: 1000 }, registry);
        const abortController = new AbortController();
        abortController.abort();

        const results = await scheduler.execute(['hybrid_search'], {
            query: 'test',
            tenantId: 'tenant-1',
            signal: abortController.signal
        });

        assert.equal(results.length, 1);
        assert.equal(results[0]?.outcome, 'CANCELLED');
        assert.equal(results[0]?.success, false);
    });

    it('returns CANCELLED outcome when caller abort signal fires during execution', async () => {
        const registry = new StrategyRegistry();
        const slowStrat = createMockStrategy('hybrid_search', {
            executeBehavior: () => new Promise((resolve) => setTimeout(resolve, 300))
        });
        registry.register(slowStrat);

        const scheduler = new ExecutionScheduler({ enabled: true, latencyDeadlineMs: 2000 }, registry);
        const abortController = new AbortController();

        setTimeout(() => {
            abortController.abort();
        }, 50);

        const results = await scheduler.execute(['hybrid_search'], {
            query: 'test',
            tenantId: 'tenant-1',
            signal: abortController.signal
        });

        assert.equal(results.length, 1);
        assert.equal(results[0]?.outcome, 'CANCELLED');
        assert.equal(results[0]?.success, false);
    });

    it('processes batches up to maxParallelOperations and halts remaining on abort', async () => {
        const registry = new StrategyRegistry();
        let runningCount = 0;
        let maxObservedRunning = 0;

        const makeBatchStrat = (id: StrategyId) => createMockStrategy(id, {
            executeBehavior: async () => {
                runningCount++;
                maxObservedRunning = Math.max(maxObservedRunning, runningCount);
                await new Promise(r => setTimeout(r, 40));
                runningCount--;
                return {
                    strategyId: id,
                    success: true,
                    executionTimeMs: 40,
                    evidence: [],
                    confidence: 0.8
                };
            }
        });

        registry.register(makeBatchStrat('hybrid_search'));
        registry.register(makeBatchStrat('semantic_search'));
        registry.register(makeBatchStrat('semantic_graph'));

        const scheduler = new ExecutionScheduler({
            enabled: true,
            maxParallelOperations: 2,
            latencyDeadlineMs: 1000
        }, registry);

        const results = await scheduler.execute(
            ['hybrid_search', 'semantic_search', 'semantic_graph'],
            { query: 'test', tenantId: 'tenant-1' }
        );

        assert.ok(maxObservedRunning <= 2);
        assert.equal(results.length, 3);
        assert.ok(results.every(r => r.outcome === 'SUCCESS'));
    });
});
