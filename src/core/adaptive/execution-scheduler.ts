import type {
    IStrategy,
    StrategyExecutionContext,
    StrategyExecutionResult,
    StrategyExecutionOutcome,
    StrategyId
} from '../../interfaces/strategy.interface.js';
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
     * @returns Array of strategy execution results including evidence, timings, and fine-grained outcomes.
     */
    public async execute(
        strategyIds: StrategyId[],
        context: StrategyExecutionContext
    ): Promise<StrategyExecutionResult[]> {
        if (strategyIds.length === 0) return [];

        const maxParallel = Math.max(1, this.config.maxParallelOperations ?? 3);
        const configuredDeadlineMs = this.config.latencyDeadlineMs ?? 5000;

        const now = Date.now();
        const effectiveDeadline = context.deadline !== undefined
            ? Math.min(now + configuredDeadlineMs, context.deadline)
            : now + configuredDeadlineMs;

        const remainingMs = Math.max(0, effectiveDeadline - Date.now());

        const abortController = new AbortController();
        let timeoutFired = false;

        const timeoutId = setTimeout(() => {
            timeoutFired = true;
            abortController.abort(new Error(`Strategy execution exceeded latency deadline of ${configuredDeadlineMs}ms`));
        }, remainingMs);

        const onCallerAbort = () => {
            abortController.abort(context.signal?.reason || new Error('Execution aborted by caller'));
        };

        if (context.signal) {
            if (context.signal.aborted) {
                abortController.abort(context.signal.reason || new Error('Execution aborted by caller'));
            } else {
                context.signal.addEventListener('abort', onCallerAbort, { once: true });
            }
        }

        const scheduledContext: StrategyExecutionContext = {
            ...context,
            signal: abortController.signal,
            deadline: effectiveDeadline
        };

        const results: StrategyExecutionResult[] = [];
        const strategiesToRun: IStrategy[] = [];
        let accumulatedCost = 0;

        const getAbortError = (isTimeout: boolean): string => {
            const reason = abortController.signal.reason ?? context.signal?.reason;
            const reasonMsg = reason instanceof Error ? reason.message : (reason ? String(reason) : '');
            if (reasonMsg) return reasonMsg;
            return isTimeout
                ? `Strategy execution exceeded latency deadline of ${configuredDeadlineMs}ms`
                : 'Execution aborted by caller';
        };

        try {
            for (const id of strategyIds) {
                if (abortController.signal.aborted) {
                    results.push({
                        strategyId: id,
                        success: false,
                        executionTimeMs: 0,
                        evidence: [],
                        confidence: 0.0,
                        error: getAbortError(timeoutFired),
                        outcome: timeoutFired ? 'TIMED_OUT' : 'CANCELLED'
                    });
                    continue;
                }

                const strat = this.registry.get(id);
                if (!strat || !strat.isEnabled()) {
                    results.push({
                        strategyId: id,
                        success: false,
                        executionTimeMs: 0,
                        evidence: [],
                        confidence: 0.0,
                        error: !strat ? `Strategy ${id} is not registered` : `Strategy ${id} is disabled`,
                        outcome: 'UNAVAILABLE'
                    });
                    continue;
                }

                if (context.budgetLimit !== undefined) {
                    const estimatedCost = strat.estimateCost(scheduledContext);
                    if (accumulatedCost + estimatedCost > context.budgetLimit) {
                        results.push({
                            strategyId: id,
                            success: false,
                            executionTimeMs: 0,
                            evidence: [],
                            confidence: 0.0,
                            error: `Estimated cost (${accumulatedCost + estimatedCost}) exceeds budget limit (${context.budgetLimit})`,
                            outcome: 'BUDGET_EXCEEDED'
                        });
                        continue;
                    }
                    accumulatedCost += estimatedCost;
                }

                try {
                    const available = await strat.isAvailable(scheduledContext);
                    if (!available) {
                        results.push({
                            strategyId: id,
                            success: false,
                            executionTimeMs: 0,
                            evidence: [],
                            confidence: 0.0,
                            error: `Strategy ${id} is currently unavailable`,
                            outcome: 'UNAVAILABLE'
                        });
                        continue;
                    }
                } catch (err: unknown) {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    results.push({
                        strategyId: id,
                        success: false,
                        executionTimeMs: 0,
                        evidence: [],
                        confidence: 0.0,
                        error: `Availability check failed for ${id}: ${errMsg}`,
                        outcome: 'UNAVAILABLE'
                    });
                    continue;
                }

                strategiesToRun.push(strat);
            }

            for (let i = 0; i < strategiesToRun.length; i += maxParallel) {
                const batch = strategiesToRun.slice(i, i + maxParallel);

                if (abortController.signal.aborted) {
                    for (const remainingStrat of strategiesToRun.slice(i)) {
                        results.push({
                            strategyId: remainingStrat.metadata.id,
                            success: false,
                            executionTimeMs: 0,
                            evidence: [],
                            confidence: 0.0,
                            error: getAbortError(timeoutFired),
                            outcome: timeoutFired ? 'TIMED_OUT' : 'CANCELLED'
                        });
                    }
                    break;
                }

                const batchPromises = batch.map(strategy =>
                    this.executeWithDeadlineRace(
                        strategy,
                        scheduledContext,
                        effectiveDeadline,
                        configuredDeadlineMs,
                        () => timeoutFired
                    )
                );
                const batchResults = await Promise.all(batchPromises);
                results.push(...batchResults);
            }
        } finally {
            clearTimeout(timeoutId);
            if (context.signal) {
                context.signal.removeEventListener('abort', onCallerAbort);
            }
        }

        return results;
    }

    /**
     * Races individual strategy execution against deadline and cancellation signals.
     */
    private async executeWithDeadlineRace(
        strategy: IStrategy,
        context: StrategyExecutionContext,
        deadlineTimestamp: number,
        configuredDeadlineMs: number,
        isTimeoutFired: () => boolean
    ): Promise<StrategyExecutionResult> {
        const stratStartTime = Date.now();
        const stratId = strategy.metadata.id;
        const remainingMs = Math.max(0, deadlineTimestamp - stratStartTime);

        let abortListener: (() => void) | null = null;
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

        const getAbortError = (isTimeout: boolean): string => {
            const reason = context.signal?.reason;
            const reasonMsg = reason instanceof Error ? reason.message : (reason ? String(reason) : '');
            if (reasonMsg) return reasonMsg;
            return isTimeout
                ? `Strategy execution exceeded latency deadline of ${configuredDeadlineMs}ms`
                : 'Execution aborted by caller';
        };

        const cancelOrTimeoutPromise = new Promise<StrategyExecutionResult>((resolve) => {
            if (context.signal?.aborted) {
                const timedOut = isTimeoutFired();
                resolve({
                    strategyId: stratId,
                    success: false,
                    executionTimeMs: 0,
                    evidence: [],
                    confidence: 0.0,
                    error: getAbortError(timedOut),
                    outcome: timedOut ? 'TIMED_OUT' : 'CANCELLED'
                });
                return;
            }

            timeoutHandle = setTimeout(() => {
                resolve({
                    strategyId: stratId,
                    success: false,
                    executionTimeMs: Date.now() - stratStartTime,
                    evidence: [],
                    confidence: 0.0,
                    error: getAbortError(true),
                    outcome: 'TIMED_OUT'
                });
            }, remainingMs);

            if (context.signal) {
                abortListener = () => {
                    const timedOut = isTimeoutFired();
                    resolve({
                        strategyId: stratId,
                        success: false,
                        executionTimeMs: Date.now() - stratStartTime,
                        evidence: [],
                        confidence: 0.0,
                        error: getAbortError(timedOut),
                        outcome: timedOut ? 'TIMED_OUT' : 'CANCELLED'
                    });
                };
                context.signal.addEventListener('abort', abortListener, { once: true });
            }
        });

        const executionPromise = (async (): Promise<StrategyExecutionResult> => {
            try {
                const res = await strategy.execute(context);
                return {
                    ...res,
                    outcome: res.outcome ?? (res.success ? 'SUCCESS' : 'FAILED')
                };
            } catch (error: unknown) {
                const errMsg = error instanceof Error ? error.message : String(error);
                return {
                    strategyId: stratId,
                    success: false,
                    executionTimeMs: Date.now() - stratStartTime,
                    evidence: [],
                    confidence: 0.0,
                    error: errMsg,
                    outcome: 'FAILED'
                };
            }
        })();

        try {
            return await Promise.race([executionPromise, cancelOrTimeoutPromise]);
        } finally {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            if (abortListener && context.signal) {
                context.signal.removeEventListener('abort', abortListener);
            }
        }
    }
}
