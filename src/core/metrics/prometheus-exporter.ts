import type { EngineMetricsSummary } from './token-tracker';

export interface PrometheusMetricOptions {
    circuitBreakerState?: 'CLOSED' | 'OPEN' | 'HALF_OPEN' | undefined;
    activeCacheSize?: number | undefined;
}

/**
 * Formats engine FinOps and runtime telemetry into OpenMetrics / Prometheus exposition format.
 * Can be scraped directly by Prometheus or Datadog agents via GET /api/metrics?format=prometheus.
 */
export class PrometheusExporter {
    public static exportMetrics(summary: EngineMetricsSummary, options?: PrometheusMetricOptions): string {
        const lines: string[] = [];

        // 1. Total queries
        lines.push('# HELP rag_queries_total Total number of queries processed by the engine');
        lines.push('# TYPE rag_queries_total counter');
        lines.push(`rag_queries_total ${summary.totalQueries}`);

        // 2. Cache hits
        lines.push('# HELP rag_cache_hits_total Total number of queries answered from in-memory or disk cache');
        lines.push('# TYPE rag_cache_hits_total counter');
        lines.push(`rag_cache_hits_total ${summary.cacheHits}`);

        // 3. Tokens consumed
        lines.push('# HELP rag_tokens_consumed_total Total tokens sent to or received from external LLMs');
        lines.push('# TYPE rag_tokens_consumed_total counter');
        lines.push(`rag_tokens_consumed_total ${summary.tokensConsumed}`);

        // 4. Tokens saved
        lines.push('# HELP rag_tokens_saved_total Estimated tokens saved by cache and semantic FAQ matching');
        lines.push('# TYPE rag_tokens_saved_total counter');
        lines.push(`rag_tokens_saved_total ${summary.tokensSaved}`);

        // 5. Estimated cost saved in USD
        lines.push('# HELP rag_estimated_cost_saved_usd Estimated monetary savings in USD based on standard GPT-4o-mini pricing');
        lines.push('# TYPE rag_estimated_cost_saved_usd gauge');
        lines.push(`rag_estimated_cost_saved_usd ${summary.estimatedCostSavedUsd.toFixed(6)}`);

        // 6. Latency percentiles
        lines.push('# HELP rag_latency_ms Query execution latency in milliseconds');
        lines.push('# TYPE rag_latency_ms summary');
        lines.push(`rag_latency_ms{quantile="0.5"} ${summary.latency.avgMs}`);
        lines.push(`rag_latency_ms{quantile="0.95"} ${summary.latency.p95Ms}`);
        lines.push(`rag_latency_ms_sum ${summary.latency.avgMs * summary.totalQueries}`);
        lines.push(`rag_latency_ms_count ${summary.totalQueries}`);

        // 7. Active Cache Size
        if (options?.activeCacheSize !== undefined) {
            lines.push('# HELP rag_cache_items Active items stored in memory cache');
            lines.push('# TYPE rag_cache_items gauge');
            lines.push(`rag_cache_items ${options.activeCacheSize}`);
        }

        // 8. Circuit Breaker State (0: CLOSED / healthy, 1: HALF_OPEN, 2: OPEN / tripped)
        if (options?.circuitBreakerState !== undefined) {
            const stateValue = options.circuitBreakerState === 'CLOSED' ? 0 : options.circuitBreakerState === 'HALF_OPEN' ? 1 : 2;
            lines.push('# HELP rag_circuit_breaker_status Circuit breaker state (0=CLOSED, 1=HALF_OPEN, 2=OPEN)');
            lines.push('# TYPE rag_circuit_breaker_status gauge');
            lines.push(`rag_circuit_breaker_status{state="${options.circuitBreakerState}"} ${stateValue}`);
        }

        return lines.join('\n') + '\n';
    }
}
