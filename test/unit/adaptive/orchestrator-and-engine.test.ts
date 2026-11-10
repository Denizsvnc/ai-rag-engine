import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RAGEngine } from '../../../src/core/engine.js';
import { MemoryGraphAdapter } from '../../../src/adapters/graph/memory-graph.adapter.js';
import type { IVectorStoreAdapter } from '../../../src/interfaces/vector.interface.js';

describe('RAGEngine Adaptive Intelligence Integration & Zero-Regression Invariant', () => {
    it('runs 100% legacy behavior without regression when adaptive is not enabled', async () => {
        const engine = new RAGEngine({
            inputs: {
                faq: {
                    getFaqs: async () => [{ question: 'iade süresi nedir?', answer: 'İade süresi 14 gündür.' }]
                }
            },
            llmProvider: {
                generate: async () => ({ content: 'Legacy LLM cevabı' })
            }
        });

        await engine.init();

        const response = await engine.query('iade süresi nedir?');
        assert.ok(response.answer);
        assert.strictEqual(response.strategyDecision, undefined); // Legacy does not attach strategyDecision
        assert.strictEqual(response.evidence, undefined);
    });

    it('routes through AdaptiveIntelligenceOrchestrator when adaptive.enabled is true', async () => {
        const graph = new MemoryGraphAdapter();
        await graph.addNodes([
            { id: 'node_kg', tenantId: 'tenant-adaptive', name: 'KVKK Politikası', type: 'compliance', confidence: 1.0 }
        ]);

        const engine = new RAGEngine({
            inputs: {
                graph,
                vectorStore: {
                    search: async () => [
                        { id: 'doc_1', content: 'KVKK kapsamında kişisel veriler korunur.', score: 0.95 }
                    ]
                } as unknown as IVectorStoreAdapter,
                rules: {
                    getActiveRules: async () => ['KVKK kural 1: Açık rıza gereklidir.']
                }
            },
            llmProvider: {
                generate: async (req) => {
                    assert.ok(req.userPrompt.includes('EVIDENCE CONTEXT'));
                    return { content: 'KVKK kapsamında kişisel veriler açık rıza ile korunur.' };
                }
            },
            adaptive: {
                enabled: true,
                mode: 'auto',
                maxParallelOperations: 2
            }
        });

        await engine.init();

        const response = await engine.query('KVKK şart ve kuralları nedir?', { tenantId: 'tenant-adaptive' });

        assert.ok(response.answer);
        assert.strictEqual(response.intent, 'ADAPTIVE_INTELLIGENCE');
        assert.ok(response.strategyDecision);
        assert.strictEqual(response.strategyDecision.mode, 'auto');
        assert.ok(response.evidence && response.evidence.length > 0);
    });
});
