import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEngineDependencies } from '../../src/core/dependency-normalizer.js';
import { RAGEngine } from '../../src/core/engine.js';
import { SMLEngine } from '../../src/core/sml-engine.js';
import { MemoryVectorAdapter } from '../../src/adapters/vector/memory-vector.adapter.js';
import { MemoryGraphAdapter } from '../../src/adapters/graph/memory-graph.adapter.js';
import { MemoryIngestionStore } from '../../src/core/ingestion/memory-ingestion-store.js';
import { InMemoryJobQueue } from '../../src/core/queue/in-memory-queue.js';
import { StaticRulesAdapter } from '../../src/adapters/rules/static-rules.adapter.js';
import type { ILLMProvider } from '../../src/interfaces/llm.interface.js';

const mockLlm: ILLMProvider = {
    generate: async () => ({ content: 'ok' })
};

describe('Dependency Resolution Normalization (Phase 5)', () => {
    const sml = new SMLEngine({ localFilesOnly: true });

    it('resolves defaults cleanly when no storage or inputs are supplied', () => {
        const normalized = normalizeEngineDependencies({
            llmProvider: mockLlm
        }, sml);

        assert.ok(normalized.vectorStore instanceof MemoryVectorAdapter);
        assert.equal(normalized.documentStore, undefined);
        assert.equal(normalized.graphStore, undefined);
        assert.ok(normalized.cacheAdapter);
        assert.equal(normalized.jobQueue, undefined);
        assert.equal(normalized.rulesAdapter, undefined);
        assert.equal(normalized.faqAdapter, undefined);
    });

    it('resolves legacy inputs.* definitions and registers capabilities', () => {
        const customVector = new MemoryVectorAdapter(sml);
        const customGraph = new MemoryGraphAdapter();
        const customRules = new StaticRulesAdapter(['Rule 1']);

        const normalized = normalizeEngineDependencies({
            llmProvider: mockLlm,
            inputs: {
                vectorStore: customVector,
                graph: customGraph,
                rules: customRules
            }
        }, sml);

        assert.equal(normalized.vectorStore, customVector);
        assert.equal(normalized.graphStore, customGraph);
        assert.equal(normalized.rulesAdapter, customRules);
        assert.equal(normalized.capabilityRegistry.hasCapability('vectors', 'denseVectorSearch'), true);
        assert.equal(normalized.capabilityRegistry.hasCapability('graph', 'graphTraversal'), true);
    });

    it('prioritizes storage.* over inputs.* when both are specified', () => {
        const inputVector = new MemoryVectorAdapter(sml);
        const storageVector = new MemoryVectorAdapter(sml);
        const inputGraph = new MemoryGraphAdapter();
        const storageGraph = new MemoryGraphAdapter();

        const normalized = normalizeEngineDependencies({
            llmProvider: mockLlm,
            storage: {
                vectors: storageVector,
                graph: storageGraph
            },
            inputs: {
                vectorStore: inputVector,
                graph: inputGraph
            }
        }, sml);

        assert.equal(normalized.vectorStore, storageVector);
        assert.equal(normalized.graphStore, storageGraph);
    });

    it('propagates unified stores into RAGEngine and AdaptiveIntelligenceOrchestrator identically', () => {
        const storageVector = new MemoryVectorAdapter(sml);
        const storageGraph = new MemoryGraphAdapter();
        const storageIngestion = new MemoryIngestionStore();
        const storageQueue = new InMemoryJobQueue();

        const engine = new RAGEngine({
            llmProvider: mockLlm,
            adaptive: { enabled: true },
            storage: {
                vectors: storageVector,
                graph: storageGraph,
                ingestion: storageIngestion,
                queue: storageQueue
            }
        });

        const orchestrator = engine.getAdaptiveOrchestrator();
        assert.ok(orchestrator);

        const registry = orchestrator.getRegistry();
        // Graph strategies should be successfully registered because graphStore was normalized
        assert.ok(registry.get('semantic_graph'));
        assert.ok(registry.get('knowledge_graph'));
        assert.ok(registry.get('graph_rag'));
    });
});
