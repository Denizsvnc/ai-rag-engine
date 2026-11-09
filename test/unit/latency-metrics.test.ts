import test from 'node:test';
import assert from 'node:assert/strict';
import { TokenTracker } from '../../src/core/metrics/token-tracker';
import { PrometheusExporter } from '../../src/core/metrics/prometheus-exporter';

test('Prometheus latency counters retain exact lifetime totals after window eviction', () => {
    const tracker = new TokenTracker();
    for (let i = 0; i < 5001; i++) tracker.trackQuery({ source: 'CACHE', userPrompt: 'q', latencyMs: i < 1000 ? 100 : 1 });
    const output = PrometheusExporter.exportMetrics(tracker.getSummary());
    assert.ok(output.includes('rag_latency_ms_sum 104001\n'));
    assert.ok(output.includes('rag_latency_ms_count 5001\n'));
    tracker.trackQuery({ source: 'CACHE', userPrompt: 'q', latencyMs: 0.12345 });
    assert.ok(PrometheusExporter.exportMetrics(tracker.getSummary()).includes('rag_latency_ms_sum 104001.12345\n'));
    tracker.reset();
    const empty = PrometheusExporter.exportMetrics(tracker.getSummary());
    assert.ok(empty.includes('rag_latency_ms_sum 0\n'));
    assert.ok(empty.includes('rag_latency_ms_count 0\n'));
});

test('invalid latency observations cannot poison metrics', () => {
    const tracker = new TokenTracker();
    for (const latencyMs of [NaN, Infinity, -1]) {
        assert.throws(() => tracker.trackQuery({ source: 'CACHE', userPrompt: 'q', latencyMs }), /latency/i);
    }
    assert.equal(tracker.getSummary().totalQueries, 0);
});


test('latency histogram counts boundary observations cumulatively and resets', () => {
    const tracker = new TokenTracker();
    for (const latencyMs of [0, 1, 5, 5.1, 60001]) tracker.trackQuery({ source: 'CACHE', userPrompt: 'q', latencyMs });
    const output = PrometheusExporter.exportMetrics(tracker.getSummary());
    assert.ok(output.includes('rag_query_duration_seconds_bucket{le="0.001"} 2\n'));
    assert.ok(output.includes('rag_query_duration_seconds_bucket{le="0.005"} 3\n'));
    assert.ok(output.includes('rag_query_duration_seconds_bucket{le="+Inf"} 5\n'));
    assert.ok(output.includes('rag_query_duration_seconds_count 5\n'));
    tracker.reset();
    assert.ok(tracker.getSummary().latency.buckets.every(bucket => bucket.count === 0));
});
