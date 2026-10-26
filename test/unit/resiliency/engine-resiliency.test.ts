import test from 'node:test';
import assert from 'node:assert/strict';
import { RAGEngine } from '../../../src/core/engine';
import { SMLEngine } from '../../../src/core/sml-engine';
import { RAGEvaluator } from '../../../src/core/metrics/rag-evaluator';
import { TokenTracker } from '../../../src/core/metrics/token-tracker';
import { PrometheusExporter } from '../../../src/core/metrics/prometheus-exporter';
import type { ILLMProvider, ILLMRequest, ILLMResponse } from '../../../src/interfaces/llm.interface';

class MockLLM implements ILLMProvider {
    async generate(req: ILLMRequest): Promise<ILLMResponse> {
        return {
            content: 'Response',
            usage: { promptTokens: 5, completionTokens: 5 }
        };
    }
}

test('Resiliency & Engineering Quality - Failure Recovery, Bounded Buffers & Evaluation', async (t) => {
    await t.test('init() Failure Recovery: Resetting initPromise allows successful subsequent initialization', async () => {
        let shouldFail = true;

        const faultyStore = {
            search: async () => [],
            insert: async () => {},
            deleteDocument: async () => {},
            clear: async () => {},
            init: async () => {
                if (shouldFail) {
                    throw new Error('Temporary connection timeout to vector DB');
                }
            }
        };

        const engine = new RAGEngine({
            llmProvider: new MockLLM(),
            inputs: { vectorStore: faultyStore as any },
            cache: { enabled: false },
            smlConfig: { enabled: false }
        });

        // First init call fails
        await assert.rejects(
            async () => await engine.init(),
            /Temporary connection timeout/
        );

        // Subsequent retry should not be stuck with old failed promise
        shouldFail = false;
        await engine.init();
        assert.ok(true, 'Second init call succeeded after failure recovery');
    });

    await t.test('SMLEngine getBatchEmbeddings: Dynamic dimension calculation produces correct vector sizes', async () => {
        const sml = new SMLEngine();
        await sml.init();

        const texts = ['First test query', 'Second query about logistics', 'Third unrelated text'];
        const embeddings = await sml.getBatchEmbeddings(texts);

        assert.equal(embeddings.length, 3);
        for (const emb of embeddings) {
            // all-MiniLM-L6-v2 dimension is 384
            assert.equal(emb.length, 384);
            // Magnitude must be approx 1.0 (normalized)
            const mag = Math.sqrt(emb.reduce((acc, v) => acc + v * v, 0));
            assert.ok(Math.abs(mag - 1.0) < 0.05);
        }
    });

    await t.test('Audit Log Ring Buffer & PII Redaction: Max 1000 cap and automatic sensitive data redaction', async () => {
        const engine = new RAGEngine({
            llmProvider: new MockLLM(),
            cache: { enabled: false },
            smlConfig: { enabled: false }
        });
        await engine.init();

        // 1. Test automatic redaction of sensitive fields
        engine.recordAuditLog({
            timestamp: new Date().toISOString(),
            toolName: 'save_payment_profile',
            tenantId: 'tenant_fin',
            userId: 'usr_secret',
            args: {
                customerName: 'John Doe',
                credit_card: '4532-0150-1234-5671',
                password: 'my-super-secret-pw',
                secret_token: 'tok_9988'
            },
            isMutating: true,
            status: 'SUCCESS',
            durationMs: 5
        });

        const logs = engine.getAuditLogs('tenant_fin');
        const lastLog = logs[logs.length - 1];
        assert.equal(lastLog?.args.customerName, 'John Doe');
        assert.equal(lastLog?.args.credit_card, '***REDACTED***');
        assert.equal(lastLog?.args.password, '***REDACTED***');
        assert.equal(lastLog?.args.secret_token, '***REDACTED***');

        // 2. Test ring buffer cap (max 1000 entries)
        for (let i = 0; i < 1050; i++) {
            engine.recordAuditLog({
                timestamp: new Date().toISOString(),
                toolName: `batch_tool_${i}`,
                tenantId: 'tenant_fin',
                args: { index: i },
                isMutating: false,
                status: 'SUCCESS',
                durationMs: 1
            });
        }

        const totalLogs = engine.getAuditLogs();
        assert.equal(totalLogs.length, 1000, 'Audit logs must be strictly capped at 1000 entries');
        // Oldest entries 0..49 must be evicted, last entry must have index 1049
        const newestLog = totalLogs[totalLogs.length - 1];
        assert.equal(newestLog?.args.index, 1049);
    });

    await t.test('RAGEvaluator: Lexical grounding score and numerical contradiction detection', () => {
        const context = 'The flight TK-1984 departs at 14:30 and the ticket price is 250 USD.';

        // Grounded answer: agrees with context facts
        const groundedAnswer = 'The ticket price is 250 USD and flight TK-1984 leaves at 14:30.';
        const evalGrounded = RAGEvaluator.evaluateGrounding(groundedAnswer, context);
        assert.equal(evalGrounded.grounded, true);
        assert.ok(evalGrounded.groundingScore > 0.6);
        assert.ok(evalGrounded.lexicalGroundingScore > 0.6);
        assert.equal(evalGrounded.contradictionsDetected?.length, 0);

        // Contradictory answer: states ticket price is 500 USD (numerical mismatch)
        const contradictoryAnswer = 'The ticket price is 500 USD and the flight leaves at 19:00.';
        const evalContradiction = RAGEvaluator.evaluateGrounding(contradictoryAnswer, context);
        assert.ok(evalContradiction.contradictionsDetected && evalContradiction.contradictionsDetected.length > 0);
        assert.ok(evalContradiction.contradictionsDetected.some(c => c.includes('500')));
    });

    await t.test('TokenTracker & PrometheusExporter: Median p50 latency calculation', () => {
        const tracker = new TokenTracker();

        // Record a series of queries with known latencies: 10, 20, 30, 40, 50, 60, 70, 80, 90, 100
        for (let i = 1; i <= 10; i++) {
            tracker.recordFullQuery(10, 5, i * 10);
        }

        const summary = tracker.getSummary();
        // Latencies: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
        // Median p50 is between 50 and 60 -> ~55 or 50
        assert.ok(summary.latency.p50Ms >= 45 && summary.latency.p50Ms <= 60);
        assert.ok(summary.latency.p95Ms >= 90);

        // Prometheus exposition format includes quantile="0.5"
        const promText = PrometheusExporter.exportMetrics(summary);
        assert.ok(promText.includes('rag_latency_ms{quantile="0.5"}'));
        assert.ok(promText.includes('rag_latency_ms{quantile="0.95"}'));
    });
});
