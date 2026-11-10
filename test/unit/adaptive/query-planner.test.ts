import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveQueryPlanner } from '../../../src/core/adaptive/query-planner.js';
import { StrategyRegistry } from '../../../src/core/adaptive/strategy-registry.js';
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

describe('AdaptiveQueryPlanner Routing & Signal Calibration', () => {
    function setupFullRegistry() {
        const graphAdapter = new MemoryGraphAdapter();
        const mockVectorStore = { search: async () => [] } as unknown as IVectorStoreAdapter;
        const mockCache = { get: async () => null, set: async () => {} } as unknown as ICacheAdapter;
        const mockRules = { getActiveRules: async () => ['kural: test'] } as unknown as IRulesAdapter;
        const mockTools = {
            getAllTools: () => [],
            routeQueryToTool: async () => null
        } as unknown as ToolRegistry;

        const registry = new StrategyRegistry(
            { enabled: true, mode: 'auto' },
            {
                hasVectorStore: true,
                hasGraphStore: true,
                hasToolRegistry: true,
                hasCacheAdapter: true,
                hasRulesAdapter: true
            }
        );

        registry.register(new TraditionalRAGStrategy(mockVectorStore, true));
        registry.register(new SemanticSearchStrategy(mockVectorStore, true));
        registry.register(new HybridSearchStrategy(mockVectorStore, true));
        registry.register(new SemanticGraphStrategy(graphAdapter, true));
        registry.register(new KnowledgeGraphStrategy(graphAdapter, true));
        registry.register(new GraphRAGStrategy(graphAdapter, mockVectorStore, true));
        registry.register(new KAGStrategy(mockRules, graphAdapter, undefined, true));
        registry.register(new CAGStrategy(mockCache, true));
        registry.register(new AgenticRAGStrategy(mockTools, true));

        return registry;
    }

    it('extracts signals accurately from Turkish and English queries', () => {
        const registry = setupFullRegistry();
        const planner = new AdaptiveQueryPlanner({ enabled: true, mode: 'auto' }, registry);

        // Exact identifier
        const sig1 = planner.extractSignals('Sipariş no TR1234567 nerede?');
        assert.strictEqual(sig1.hasExactIdentifiers, true);

        // Multi-hop / relationship
        const sig2 = planner.extractSignals('Ali ile Veli arasındaki bağlantı ve hiyerarşi nedir?');
        assert.strictEqual(sig2.hasMultiHopKeywords, true);

        // KAG rule
        const sig3 = planner.extractSignals('Bu çalışan yıllık izin şart ve kurallarına uygun mu?');
        assert.strictEqual(sig3.hasLogicalRuleKeywords, true);

        // Agentic action
        const sig4 = planner.extractSignals('Lütfen stok miktarını 50 olarak güncelle');
        assert.strictEqual(sig4.hasActionKeywords, true);

        // English signals
        const sigEn = planner.extractSignals('Does this transaction violate compliance rule and policy logic?');
        assert.strictEqual(sigEn.hasLogicalRuleKeywords, true);
    });

    it('routes action queries to agentic_rag in auto mode', async () => {
        const registry = setupFullRegistry();
        const planner = new AdaptiveQueryPlanner({ enabled: true, mode: 'auto' }, registry);

        const decision = await planner.plan({
            query: 'Kullanıcının siparişini güncelle ve sistemi çalıştır',
            tenantId: 'tenant-1'
        });

        assert.strictEqual(decision.mode, 'auto');
        assert.ok(decision.selectedStrategies.includes('agentic_rag'));
    });

    it('routes rule and compliance queries to kag in auto mode', async () => {
        const registry = setupFullRegistry();
        const planner = new AdaptiveQueryPlanner({ enabled: true, mode: 'auto' }, registry);

        const decision = await planner.plan({
            query: 'Müşteri iade şartı ve kurallarına göre hak kazanır mı?',
            tenantId: 'tenant-1'
        });

        assert.strictEqual(decision.mode, 'auto');
        assert.ok(decision.selectedStrategies.includes('kag'));
    });

    it('routes multi-hop questions to graph_rag in auto mode', async () => {
        const registry = setupFullRegistry();
        const planner = new AdaptiveQueryPlanner({ enabled: true, mode: 'auto' }, registry);

        const decision = await planner.plan({
            query: 'CEO ile departman liderleri arasındaki ilişki ve bağlantı haritası nedir?',
            tenantId: 'tenant-1'
        });

        assert.strictEqual(decision.mode, 'auto');
        assert.ok(decision.selectedStrategies.includes('graph_rag'));
    });

    it('routes conceptual exploration to semantic_graph in auto mode', async () => {
        const registry = setupFullRegistry();
        const planner = new AdaptiveQueryPlanner({ enabled: true, mode: 'auto' }, registry);

        const decision = await planner.plan({
            query: 'Yapay zeka etiği hakkında kavram haritası ve tematik benzer konular',
            tenantId: 'tenant-1'
        });

        assert.strictEqual(decision.mode, 'auto');
        assert.ok(decision.selectedStrategies.includes('semantic_graph'));
    });

    it('honors manual mode and overrides', async () => {
        const registry = setupFullRegistry();
        const planner = new AdaptiveQueryPlanner({ enabled: true, mode: 'manual' }, registry);

        const decision = await planner.plan({
            query: 'Genel bir soru',
            tenantId: 'tenant-1',
            metadata: {
                requestedMode: 'manual',
                requestedStrategy: 'semantic_search'
            }
        });

        assert.strictEqual(decision.mode, 'manual');
        assert.deepStrictEqual(decision.selectedStrategies, ['semantic_search']);
    });

    it('selects multiple complementary strategies in auto-hybrid mode up to maxParallelOperations', async () => {
        const registry = setupFullRegistry();
        const planner = new AdaptiveQueryPlanner(
            { enabled: true, mode: 'auto-hybrid', maxParallelOperations: 3 },
            registry
        );

        const decision = await planner.plan({
            query: 'Sipariş TR999888 kural ve şartlara göre bağlantı zinciri nasıl?',
            tenantId: 'tenant-1'
        });

        assert.strictEqual(decision.mode, 'auto-hybrid');
        assert.ok(decision.selectedStrategies.length >= 2);
        assert.ok(decision.selectedStrategies.length <= 3);
        assert.ok(decision.selectedStrategies.includes('graph_rag') || decision.selectedStrategies.includes('kag'));
    });

    it('falls back systematically in fallback mode', async () => {
        const registry = setupFullRegistry();
        const planner = new AdaptiveQueryPlanner(
            {
                enabled: true,
                mode: 'fallback',
                fallbackChain: ['hybrid_search', 'traditional_rag']
            },
            registry
        );

        const decision = await planner.plan({
            query: 'Ürün özellikleri nelerdir?',
            tenantId: 'tenant-1'
        });

        assert.strictEqual(decision.mode, 'fallback');
        assert.strictEqual(decision.selectedStrategies[0], 'hybrid_search');
        assert.strictEqual(decision.selectedStrategies[1], 'traditional_rag');
    });
});

