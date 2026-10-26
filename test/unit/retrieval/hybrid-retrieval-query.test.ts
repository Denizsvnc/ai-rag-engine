import test from 'node:test';
import assert from 'node:assert/strict';
import { RAGEngine } from '../../../src/core/engine';
import { MemoryVectorAdapter } from '../../../src/adapters/vector/memory-vector.adapter';
import { SMLEngine } from '../../../src/core/sml-engine';
import type { ILLMProvider, ILLMRequest, ILLMResponse } from '../../../src/interfaces/llm.interface';

class ContextCapturingLLM implements ILLMProvider {
    public capturedSystemPrompt: string | undefined;
    async generate(req: ILLMRequest): Promise<ILLMResponse> {
        this.capturedSystemPrompt = req.systemPrompt;
        return {
            content: 'LLM answer generated from context',
            usage: { promptTokens: 10, completionTokens: 5 }
        };
    }
}

test('Retrieval Layer - Hybrid Search & Engine Query Pipeline', async (t) => {
    const smlEngine = new SMLEngine();
    const vectorStore = new MemoryVectorAdapter(smlEngine);
    const mockLLM = new ContextCapturingLLM();

    const engine = new RAGEngine({
        llmProvider: mockLLM,
        inputs: { vectorStore },
        cache: { enabled: false },
        smlConfig: { enabled: false },
        retrieval: {
            strategy: 'hybrid',
            topK: 2,
            minRelevanceScore: 0.001
        }
    });

    await engine.init();

    // Populate documents
    await vectorStore.insert({
        id: 'doc_sku_1',
        content: 'Product SKU-8899-X: Quantum mechanical keyboard with RGB backlighting.',
        metadata: { category: 'hardware' }
    });

    await vectorStore.insert({
        id: 'doc_sku_2',
        content: 'Product SKU-8899-Y: Wireless ergonomic mouse with silent switches.',
        metadata: { category: 'hardware' }
    });

    await vectorStore.insert({
        id: 'doc_unrelated',
        content: 'Gardening tips: Best soil and water schedule for indoor bonsai trees.',
        metadata: { category: 'gardening' }
    });

    await t.test('RAGEngine.query with hybrid retrieval blends vector and keyword context into LLM prompt', async () => {
        const result = await engine.query('Tell me about SKU-8899-X keyboard');

        assert.ok(mockLLM.capturedSystemPrompt, 'System prompt with context must be passed to LLM');
        assert.ok(mockLLM.capturedSystemPrompt.includes('SKU-8899-X'), 'Context must contain exact SKU match');
        assert.equal(result.resolvedBy, 'LLM_RAG');
        assert.ok(result.sources?.includes('doc_sku_1'));
    });

    await t.test('topK retrieval limit enforces maximum context documents', async () => {
        // Query matching multiple hardware items
        await engine.query('hardware accessories SKU-8899');
        assert.ok(mockLLM.capturedSystemPrompt);
        // Bonsai tree must not be included
        assert.ok(!mockLLM.capturedSystemPrompt.includes('bonsai'));
    });

    await t.test('MemoryVectorAdapter contract: deleteDocument and clear work as expected', async () => {
        const initialCount = (await vectorStore.search('Quantum mechanical keyboard')).length;
        assert.ok(initialCount > 0);

        // Delete specific document
        await vectorStore.deleteDocument('doc_sku_1');
        const afterDelete = await vectorStore.search('Quantum mechanical keyboard');
        assert.ok(afterDelete.every(d => d.id !== 'doc_sku_1'), 'Deleted document must not be found');

        // Clear all
        await vectorStore.clear();
        const afterClear = await vectorStore.search('SKU-8899-Y');
        assert.equal(afterClear.length, 0, 'Vector store must be empty after clear()');
    });
});
