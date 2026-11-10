import { test, describe } from 'node:test';
import assert from 'node:assert';
import { RAGEvaluator } from '../../src/core/metrics/rag-evaluator';
import { PrometheusExporter } from '../../src/core/metrics/prometheus-exporter';
import type { EngineMetricsSummary } from '../../src/core/metrics/token-tracker';

describe('RAG Evaluation System & Prometheus Telemetry', () => {
    test('RAGEvaluator should calculate precision@K, recall@K, and MRR accurately', () => {
        const retrieved = ['doc1', 'doc2', 'doc3', 'doc4', 'doc5'];
        const groundTruth = ['doc2', 'doc4'];

        const pAt3 = RAGEvaluator.precisionAtK(retrieved, groundTruth, 3);
        // In top 3: ['doc1', 'doc2', 'doc3'], only 'doc2' is relevant. 1 / 3 = 0.3333
        assert.strictEqual(pAt3, 0.3333);

        const rAt3 = RAGEvaluator.recallAtK(retrieved, groundTruth, 3);
        // 1 relevant doc out of 2 total relevant docs. 1 / 2 = 0.5
        assert.strictEqual(rAt3, 0.5);

        const rr = RAGEvaluator.reciprocalRank(retrieved, groundTruth);
        // First hit is 'doc2' at index 1 (rank 2). 1 / 2 = 0.5
        assert.strictEqual(rr, 0.5);
    });

    test('RAGEvaluator should detect grounded answers and flag hallucinated/ungrounded claims', () => {
        const context = [
            'The enterprise warranty covers accidental hardware damage for up to 36 months.',
            'Batteries are replaced for free if health drops below 80 percent.'
        ];

        // 1. Completely grounded answer
        const groundedAnswer = 'The enterprise warranty covers hardware damage for 36 months. Batteries are replaced free if health drops below 80 percent.';
        const groundedEval = RAGEvaluator.evaluateFaithfulness(groundedAnswer, context);
        assert.ok(groundedEval.score >= 0.8);
        assert.strictEqual(groundedEval.ungroundedClaims.length, 0);

        // 2. Hallucinated answer with fabricated facts
        const hallucinatedAnswer = 'We will also fly a technician via private helicopter to your house and provide free gold coins.';
        const ungroundedEval = RAGEvaluator.evaluateFaithfulness(hallucinatedAnswer, context);
        assert.ok(ungroundedEval.score < 0.4);
        assert.ok(ungroundedEval.ungroundedClaims.length > 0);

        // 3. Empty answer should NOT score 100% grounded
        const emptyEval = RAGEvaluator.evaluateFaithfulness('', context);
        assert.strictEqual(emptyEval.score, 0.0);
        assert.ok(emptyEval.ungroundedClaims.length > 0);

        // 4. Negation polarity mismatch detection
        const negatedAnswer = 'The enterprise warranty does not cover accidental hardware damage.';
        const negatedEval = RAGEvaluator.evaluateFaithfulness(negatedAnswer, context);
        assert.ok(negatedEval.contradictionsDetected.some(c => c.includes('Polarity Warning')));
        assert.ok(negatedEval.score < 0.5);
    });

    test('RAGEvaluator should deduplicate duplicate retrieved IDs in precisionAtK', () => {
        // If a buggy retriever returns doc1 three times when only doc1 is relevant:
        // Raw duplicate hits would be 3/3 = 1.0. Deduplicated unique hit is 1/1 = 1.0, but for top-3 (3 slots):
        // Unique top-k is ['doc1'], hits = 1, topK.length = 1.
        const duplicateRetrieved = ['doc1', 'doc1', 'doc1'];
        const groundTruth = ['doc1'];

        const pAt3 = RAGEvaluator.precisionAtK(duplicateRetrieved, groundTruth, 3);
        assert.strictEqual(pAt3, 1.0);

        const mixedDuplicate = ['doc1', 'doc1', 'doc2', 'doc3'];
        const groundTruth2 = ['doc3'];
        // Unique order: ['doc1', 'doc2', 'doc3']. In top-3, only 'doc3' is relevant -> 1 / 3 = 0.3333
        const pAt3Mixed = RAGEvaluator.precisionAtK(mixedDuplicate, groundTruth2, 3);
        assert.strictEqual(pAt3Mixed, 0.3333);
    });

    test('PrometheusExporter should format engine telemetry into valid Prometheus exposition text', () => {
        const mockSummary: EngineMetricsSummary = {
            totalQueries: 100,
            cacheHits: 45,
            faqHits: 20,
            smlToolHits: 15,
            llmCalls: 20,
            securityBlocked: 0,
            zeroTokenRate: '65.0%',
            tokensConsumed: 4500,
            tokensSaved: 12000,
            estimatedCostUsd: 0.0135,
            estimatedCostSavedUsd: 0.036,
            latency: { minMs: 2, maxMs: 250, avgMs: 45, p50Ms: 20, p95Ms: 180, p99Ms: 240, sumMs: 4500, count: 100, buckets: [] }
        };

        const exportedText = PrometheusExporter.exportMetrics(mockSummary, {
            activeCacheSize: 85,
            circuitBreakerState: 'CLOSED'
        });

        assert.ok(exportedText.includes('rag_queries_total 100'));
        assert.ok(exportedText.includes('rag_cache_hits_total 45'));
        assert.ok(exportedText.includes('rag_tokens_consumed_total 4500'));
        assert.ok(exportedText.includes('rag_tokens_saved_total 12000'));
        assert.ok(exportedText.includes('rag_latency_ms{quantile="0.95"} 180'));
        assert.ok(exportedText.includes('rag_circuit_breaker_status{state="CLOSED"} 0'));
        assert.ok(exportedText.includes('rag_cache_items 85'));
    });
});
