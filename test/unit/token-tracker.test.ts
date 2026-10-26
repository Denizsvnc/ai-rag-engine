import test from 'node:test';
import assert from 'node:assert/strict';
import { TokenTracker } from '../../src/core/metrics/token-tracker';

test('FinOps Metrics - TokenTracker', async (t) => {
    await t.test('should accurately estimate tokens for English and multilingual text', () => {
        const tracker = new TokenTracker();
        assert.equal(tracker.estimateTokens(''), 0);
        assert.equal(tracker.estimateTokens('   '), 0);
        
        const shortEng = 'Hello world';
        assert.ok(tracker.estimateTokens(shortEng) >= 2);

        const turkishText = 'Siparişimin kargo takip numarasını ve güncel teslimat durumunu öğrenmek istiyorum.';
        const estimatedTr = tracker.estimateTokens(turkishText);
        assert.ok(estimatedTr > 10, 'Agglutinative Turkish sentence should estimate realistic token count');
    });

    await t.test('should track cache hits with zero token consumption and baseline token savings', () => {
        const tracker = new TokenTracker({ baselineTokensPerQuery: 400, costPerThousandTokensUsd: 0.003 });
        const metrics = tracker.trackQuery({
            source: 'CACHE',
            userPrompt: 'İade koşulları nedir?',
            answer: '14 gün içinde iade edebilirsiniz.',
            latencyMs: 1.2
        });

        assert.equal(metrics.tokensConsumed, 0);
        assert.equal(metrics.tokensSaved, 400);
        assert.equal(metrics.estimatedCostSavedUsd, 0.0012);
        assert.equal(metrics.source, 'CACHE');

        const summary = tracker.getSummary();
        assert.equal(summary.totalQueries, 1);
        assert.equal(summary.cacheHits, 1);
        assert.equal(summary.zeroTokenRate, '100.0%');
        assert.equal(summary.tokensConsumed, 0);
        assert.equal(summary.tokensSaved, 400);
    });

    await t.test('should track semantic FAQ hits with zero token consumption', () => {
        const tracker = new TokenTracker({ baselineTokensPerQuery: 500 });
        const metrics = tracker.trackQuery({
            source: 'FAQ',
            userPrompt: 'Kargo ne zaman gelir?',
            answer: '1-3 iş günü.',
            latencyMs: 4.5
        });

        assert.equal(metrics.tokensConsumed, 0);
        assert.equal(metrics.tokensSaved, 500);
        assert.equal(metrics.source, 'FAQ');
    });

    await t.test('should track full LLM calls and record consumed tokens and latency stats', () => {
        const tracker = new TokenTracker({ baselineTokensPerQuery: 400 });
        tracker.trackQuery({
            source: 'LLM_RAG',
            userPrompt: 'Explain quantum computing in detail',
            usage: { promptTokens: 120, completionTokens: 180 },
            latencyMs: 350
        });

        const summary = tracker.getSummary();
        assert.equal(summary.llmCalls, 1);
        assert.equal(summary.tokensConsumed, 300);
        assert.equal(summary.latency.avgMs, 350);
        assert.equal(summary.latency.maxMs, 350);
        assert.equal(summary.latency.minMs, 350);
    });

    await t.test('should reset metrics cleanly', () => {
        const tracker = new TokenTracker();
        tracker.trackQuery({ source: 'CACHE', userPrompt: 'test', latencyMs: 2 });
        assert.equal(tracker.getSummary().totalQueries, 1);

        tracker.reset();
        assert.equal(tracker.getSummary().totalQueries, 0);
        assert.equal(tracker.getSummary().tokensSaved, 0);
    });
});
