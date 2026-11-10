import type { IStrategy, StrategyExecutionContext, StrategyExecutionResult } from '../../interfaces/strategy.interface.js';
import type { AdaptiveIntelligenceConfig } from '../../interfaces/adaptive-config.interface.js';
import type { StrategyRegistry } from './strategy-registry.js';

/**
 * Concurrency scheduler and deadline manager for adaptive strategy execution.
 *
 * @remarks
 * Orchestrates parallel and chunked strategy dispatch subject to `maxParallelOperations`,
 * sets up strict latency deadlines via `AbortController`, and isolates faults so that individual
 * strategy errors never crash the overall retrieval process.
 *
 * @example
 * ```typescript
 * import { ExecutionScheduler, StrategyRegistry } from '@denizsvnc/ai-rag-engine';
 *
 * const scheduler = new ExecutionScheduler(
 *   { maxParallelOperations: 2, latencyDeadlineMs: 3000 },
 *   registry
 * );
 *
 * const results = await scheduler.execute(['hybrid_search', 'kag'], context);
 * ```
 */
export class ExecutionScheduler {
    /**
     * Initializes a new ExecutionScheduler instance.
     *
     * @param config - Adaptive intelligence configuration specifying parallelism and deadlines.
     * @param registry - Strategy registry to resolve strategy instances.
     */
    constructor(
        private readonly config: AdaptiveIntelligenceConfig,
        private readonly registry: StrategyRegistry
    ) {}

    /**
     * Executes the selected strategies either concurrently (up to maxParallelOperations)
     * or sequentially with deadline enforcement and error isolation.
     *
     * @param strategyIds - Array of strategy IDs selected by the query planner.
     * @param context - Strategy execution context containing user query, tenantId, and signal.
     * @returns Array of strategy execution results including evidence and execution timings.
     */
    public async execute(
        strategyIds: import('../../interfaces/strategy.interface.js').StrategyId[],
        context: StrategyExecutionContext
    ): Promise<StrategyExecutionResult[]> {
        if (strategyIds.length === 0) return [];

        const maxParallel = Math.max(1, this.config.maxParallelOperations ?? 3);
        const deadlineMs = this.config.latencyDeadlineMs ?? 5000;

        // Set up AbortController for deadline management
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => {
            abortController.abort(new Error(`Strategy execution exceeded latency deadline of ${deadlineMs}ms`));
        }, deadlineMs);

        // Chain caller signal if provided
        if (context.signal) {
            context.signal.addEventListener('abort', () => abortController.abort(context.signal?.reason));
        }

        const scheduledContext: StrategyExecutionContext = {
            ...context,
            signal: abortController.signal
        };

        const results: StrategyExecutionResult[] = [];
        const strategiesToRun: IStrategy[] = [];

        for (const id of strategyIds) {
            const strat = this.registry.get(id);
            if (strat && strat.isEnabled()) {
                strategiesToRun.push(strat);
            }
        }

        try {
            // Process strategies in parallel chunks bounded by maxParallel
            for (let i = 0; i < strategiesToRun.length; i += maxParallel) {
                if (abortController.signal.aborted) break;

                const batch = strategiesToRun.slice(i, i + maxParallel);
                const batchPromises = batch.map(async (strategy): Promise<StrategyExecutionResult> => {
                    const stratStartTime = Date.now();
                    try {
                        const res = await strategy.execute(scheduledContext);
                        return res;
                    } catch (error: unknown) {
                        const errMsg = error instanceof Error ? error.message : String(error);
                        return {
                            strategyId: strategy.metadata.id,
                            success: false,
                            executionTimeMs: Date.now() - stratStartTime,
                            evidence: [],
                            confidence: 0.0,
                            error: errMsg
                        };
                    }
                });

                const batchResults = await Promise.all(batchPromises);
                results.push(...batchResults);
            }
        } finally {
            clearTimeout(timeoutId);
        }

        return results;
    }
}

