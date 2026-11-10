import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TraditionalRAGStrategy } from '../../../src/core/adaptive/strategies/traditional-rag.strategy.js';
import { SemanticSearchStrategy } from '../../../src/core/adaptive/strategies/semantic-search.strategy.js';
import { HybridSearchStrategy } from '../../../src/core/adaptive/strategies/hybrid-search.strategy.js';
import { SemanticGraphStrategy } from '../../../src/core/adaptive/strategies/semantic-graph.strategy.js';
import { KnowledgeGraphStrategy } from '../../../src/core/adaptive/strategies/knowledge-graph.strategy.js';
import { GraphRAGStrategy } from '../../../src/core/adaptive/strategies/graph-rag.strategy.js';
import { KAGStrategy } from '../../../src/core/adaptive/strategies/kag.strategy.js';
import { CAGStrategy } from '../../../src/core/adaptive/strategies/cag.strategy.js';
import { AgenticRAGStrategy } from '../../../src/core/adaptive/strategies/agentic-rag.strategy.js';
import { MemoryGraphAdapter } from '../../../src/adapters/graph/memory-graph.adapter.js';
import type { IVectorStoreAdapter } from '../../../src/interfaces/vector.interface.js';
import type { ICacheAdapter } from '../../../src/interfaces/cache.interface.js';
import type { IRulesAdapter } from '../../../src/interfaces/rules.interface.js';
import type { ToolRegistry } from '../../../src/core/tool-registry.js';

describe('9 Multi-Strategy Independent Executions', () => {
    it('TraditionalRAGStrategy executes vector search and returns evidence items', async () => {
        const mockVectorStore = {
            search: async () => [{ id: 'doc1', content: 'traditional chunk', score: 0.88, metadata: { title: 'Doc 1' } }]
        } as unknown as IVectorStoreAdapter;

        const strat = new TraditionalRAGStrategy(mockVectorStore, true);
        const res = await strat.execute({ query: 'test query', tenantId: 't1' });

        assert.strictEqual(res.success, true);
        assert.strictEqual(res.strategyId, 'traditional_rag');
        assert.strictEqual(res.evidence.length, 1);
        assert.strictEqual(res.evidence[0]?.content, 'traditional chunk');
    });

    it('SemanticSearchStrategy filters by similarity threshold and topK', async () => {
        const mockVectorStore = {
            search: async () => [
                { id: 'doc1', content: 'high score', score: 0.95 },
                { id: 'doc2', content: 'low score', score: 0.20 }
            ]
        } as unknown as IVectorStoreAdapter;

        const strat = new SemanticSearchStrategy(mockVectorStore, true);
        const res = await strat.execute({ query: 'semantic search', tenantId: 't1', similarityThreshold: 0.5 });

        assert.strictEqual(res.success, true);
        assert.strictEqual(res.evidence.length, 1);
        assert.strictEqual(res.evidence[0]?.content, 'high score');
    });

    it('HybridSearchStrategy executes dense and keyword hybrid search', async () => {
        const mockVectorStore = {
            search: async () => [{ id: 'doc_hybrid', content: 'hybrid content', score: 0.92 }]
        } as unknown as IVectorStoreAdapter;

        const strat = new HybridSearchStrategy(mockVectorStore, true);
        const res = await strat.execute({ query: 'hybrid search', tenantId: 't1' });

        assert.strictEqual(res.success, true);
        assert.strictEqual(res.strategyId, 'hybrid_search');
        assert.strictEqual(res.evidence[0]?.content, 'hybrid content');
    });

    it('KnowledgeGraphStrategy and SemanticGraphStrategy traverse subgraphs', async () => {
        const graph = new MemoryGraphAdapter();
        await graph.addNodes([
            { id: 'n1', tenantId: 't1', name: 'Yapay Zeka', type: 'concept', confidence: 1.0 },
            { id: 'n2', tenantId: 't1', name: 'Derin Öğrenme', type: 'concept', confidence: 1.0 }
        ]);
        await graph.addEdges([
            { id: 'e1', tenantId: 't1', sourceId: 'n1', targetId: 'n2', relation: 'CONTAINS', category: 'semantic', weight: 0.9, confidence: 0.95 }
        ]);

        const kgStrat = new KnowledgeGraphStrategy(graph, true);
        const kgRes = await kgStrat.execute({ query: 'Yapay Zeka', tenantId: 't1' });

        assert.strictEqual(kgRes.success, true);
        assert.strictEqual(kgRes.strategyId, 'knowledge_graph');
        assert.ok(kgRes.evidence.length > 0);

        const semStrat = new SemanticGraphStrategy(graph, true);
        const semRes = await semStrat.execute({ query: 'Yapay Zeka', tenantId: 't1' });
        assert.strictEqual(semRes.success, true);
        assert.strictEqual(semRes.strategyId, 'semantic_graph');
    });

    it('GraphRAGStrategy integrates vector retrieval with graph neighbor traversal', async () => {
        const graph = new MemoryGraphAdapter();
        await graph.addNodes([
            { id: 'entity_auth', tenantId: 't1', name: 'AuthService', type: 'service', confidence: 1.0, sourceDocId: 'auth_spec' },
            { id: 'entity_db', tenantId: 't1', name: 'UserDatabase', type: 'database', confidence: 1.0, sourceDocId: 'auth_spec' }
        ]);
        await graph.addEdges([
            { id: 'e_connect', tenantId: 't1', sourceId: 'entity_auth', targetId: 'entity_db', relation: 'CONNECTS_TO', category: 'extracted', weight: 0.9, confidence: 0.9 }
        ]);

        const mockVector = {
            search: async () => [{ id: 'auth_spec', content: 'AuthService handles security tokens', score: 0.91 }]
        } as unknown as IVectorStoreAdapter;

        const graphRAG = new GraphRAGStrategy(graph, mockVector, true);
        const res = await graphRAG.execute({ query: 'AuthService security', tenantId: 't1' });

        assert.strictEqual(res.success, true);
        assert.strictEqual(res.strategyId, 'graph_rag');
        assert.ok(res.evidence.length >= 1);
    });

    it('KAGStrategy evaluates rules and logic', async () => {
        const mockRules = {
            getActiveRules: async () => ['Kural 1: Şirket personeli mesai saatlerinde izin almalıdır.']
        } as unknown as IRulesAdapter;
        const graph = new MemoryGraphAdapter();

        const kag = new KAGStrategy(mockRules, graph, undefined, true);
        const res = await kag.execute({ query: 'personel izin kuralı nedir?', tenantId: 't1' });

        assert.strictEqual(res.success, true);
        assert.strictEqual(res.strategyId, 'kag');
        assert.ok(res.evidence.length > 0);
        assert.ok(res.evidence[0]?.content.includes('Kural 1'));
    });

    it('CAGStrategy returns answerDraft on cache hit', async () => {
        const mockCache = {
            get: async () => ({
                answer: 'Önceden önbelleğe alınmış yanıt',
                sources: ['cag_cache'],
                cachedAt: Date.now()
            }),
            set: async () => {}
        } as unknown as ICacheAdapter;

        const cag = new CAGStrategy(mockCache, true);
        const res = await cag.execute({ query: 'sık sorulan soru', tenantId: 't1' });

        assert.strictEqual(res.success, true);
        assert.strictEqual(res.strategyId, 'cag');
        assert.strictEqual(res.answerDraft, 'Önceden önbelleğe alınmış yanıt');
    });

    it('AgenticRAGStrategy executes read-only tool and preserves safe boundaries', async () => {
        const readOnlyTool = {
            name: 'get_exchange_rate',
            description: 'Returns current currency exchange rates',
            isMutating: false,
            requiresConfirmation: false,
            execute: async () => ({ USD: 36.5, EUR: 38.2 })
        };

        const mutatingTool = {
            name: 'transfer_money',
            description: 'Transfers money to another account',
            isMutating: true,
            requiresConfirmation: true,
            execute: async () => ({ transferred: true })
        };

        const mockToolRegistry = {
            getAllTools: () => [readOnlyTool, mutatingTool],
            routeQueryToTool: async () => readOnlyTool
        } as unknown as ToolRegistry;

        const agentic = new AgenticRAGStrategy(mockToolRegistry, true);
        const res = await agentic.execute({ query: 'get_exchange_rate USD to TRY', tenantId: 't1' });

        assert.strictEqual(res.success, true);
        assert.strictEqual(res.strategyId, 'agentic_rag');

        // Read-only tool should have executed and returned result
        const executed = res.evidence.find(e => e.sourceDocId === 'tool_get_exchange_rate');
        assert.ok(executed);
        assert.ok(executed.content.includes('36.5'));
    });
});

