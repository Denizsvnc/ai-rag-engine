import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionScheduler } from '../../../src/core/adaptive/execution-scheduler.js';
import { StrategyRegistry } from '../../../src/core/adaptive/strategy-registry.js';
import type { IStrategy, StrategyExecutionContext, StrategyExecutionResult, StrategyId } from '../../../src/interfaces/strategy.interface.js';

describe('ExecutionScheduler Concurrency & Fault Isolation', () => {
    function createMockStrategy(
        id: StrategyId,
        delayMs: number,
        shouldFail: boolean = false,
        evidenceContent: string = 'test'
    ): IStrategy {
        return {
            metadata: {
                id,
                name: id,
                description: id,
                category: 'retrieval',
                supportsStreaming: false,
                supportsMultiTenant: true,
                requiresGraphIndex: false,
                requiresVectorStore: false,
                requiresToolRegistry: false,
                typicalLatencyMs: delayMs,
                estimatedCostPerQuery: 0.001
            },
            isEnabled: () => true,
            isAvailable: async () => true,
            estimateCost: () => 0.001,
            estimateLatency: () => delayMs,
            execute: async (ctx: StrategyExecutionContext): Promise<StrategyExecutionResult> => {
                if (delayMs > 0) {
                    await new Promise((resolve, reject) => {
                        const t = setTimeout(resolve, delayMs);
                        ctx.signal?.addEventListener('abort', () => {
                            clearTimeout(t);
                            reject(ctx.signal?.reason || new Error('Aborted'));
                        });
                    });
                }
                if (shouldFail) {
                    throw new Error(`Strategy ${id} deliberate fault`);
                }
                return {
                    strategyId: id,
                    success: true,
                    executionTimeMs: delayMs,
                    evidence: [{
                        id: `ev_${id}`,
                        strategyId: id,
                        evidenceType: 'text_chunk',
                        sourceDocId: `doc_${id}`,
                        tenantId: ctx.tenantId,
                        content: evidenceContent,
                        score: 0.95
                    }],
                    confidence: 0.95
                };
            }
        };
    }

    it('executes multiple strategies concurrently and collects all results', async () => {
        const registry = new StrategyRegistry();
        registry.register(createMockStrategy('traditional_rag', 10));
        registry.register(createMockStrategy('semantic_search', 15));

        const scheduler = new ExecutionScheduler({ enabled: true, maxParallelOperations: 2 }, registry);

        const results = await scheduler.execute(['traditional_rag', 'semantic_search'], {
            query: 'test query',
            tenantId: 'tenant-abc'
        });

        assert.strictEqual(results.length, 2);
        assert.strictEqual(results[0].success, true);
        assert.strictEqual(results[1].success, true);
    });

    it('isolates strategy failure so one failure does not break other running strategies', async () => {
        const registry = new StrategyRegistry();
        registry.register(createMockStrategy('traditional_rag', 5, true)); // Will fail
        registry.register(createMockStrategy('hybrid_search', 10, false, 'healthy result')); // Healthy

        const scheduler = new ExecutionScheduler({ enabled: true, maxParallelOperations: 2 }, registry);

        const results = await scheduler.execute(['traditional_rag', 'hybrid_search'], {
            query: 'resilience test',
            tenantId: 'tenant-1'
        });

        assert.strictEqual(results.length, 2);
        const failed = results.find(r => r.strategyId === 'traditional_rag');
        const succeeded = results.find(r => r.strategyId === 'hybrid_search');

        assert.ok(failed);
        assert.strictEqual(failed.success, false);
        assert.ok(failed.error?.includes('deliberate fault'));

        assert.ok(succeeded);
        assert.strictEqual(succeeded.success, true);
        assert.strictEqual(succeeded.evidence.length, 1);
        assert.strictEqual(succeeded.evidence[0].content, 'healthy result');
    });

    it('enforces latency deadline with AbortController', async () => {
        const registry = new StrategyRegistry();
        // Strategy takes 200ms, but deadline is 30ms
        registry.register(createMockStrategy('graph_rag', 200));

        const scheduler = new ExecutionScheduler(
            { enabled: true, latencyDeadlineMs: 30, maxParallelOperations: 1 },
            registry
        );

        const results = await scheduler.execute(['graph_rag'], {
            query: 'timeout query',
            tenantId: 'tenant-1'
        });

        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].success, false);
        assert.ok(results[0].error?.includes('deadline') || results[0].error?.includes('Abort'));
    });

    it('propagates caller AbortSignal immediately', async () => {
        const registry = new StrategyRegistry();
        registry.register(createMockStrategy('agentic_rag', 100));

        const scheduler = new ExecutionScheduler({ enabled: true }, registry);

        const callerController = new AbortController();
        setTimeout(() => callerController.abort(new Error('Caller aborted early')), 10);

        const results = await scheduler.execute(['agentic_rag'], {
            query: 'cancel test',
            tenantId: 'tenant-1',
            signal: callerController.signal
        });

        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].success, false);
        assert.ok(results[0].error?.includes('aborted') || results[0].error?.includes('Abort'));
    });
});

