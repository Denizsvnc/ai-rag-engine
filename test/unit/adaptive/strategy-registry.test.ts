import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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

describe('StrategyRegistry Lifecycle & Capability Resolution', () => {
    it('registers and retrieves enabled strategies', () => {
        const registry = new StrategyRegistry();
        const traditional = new TraditionalRAGStrategy(undefined, true);
        registry.register(traditional);

        assert.strictEqual(registry.has('traditional_rag'), true);
        const resolved = registry.get('traditional_rag');
        assert.ok(resolved);
        assert.strictEqual(resolved.metadata.id, 'traditional_rag');
        assert.strictEqual(resolved.metadata.category, 'retrieval');
    });

    it('filters enabled strategies correctly', () => {
        const registry = new StrategyRegistry();
        const enabledStrategy = new TraditionalRAGStrategy(undefined, true);
        const disabledStrategy = new SemanticSearchStrategy(undefined, false);

        registry.register(enabledStrategy);
        registry.register(disabledStrategy);

        const all = registry.getAll();
        const enabled = registry.getEnabled();

        assert.strictEqual(all.length, 2);
        assert.strictEqual(enabled.length, 1);
        assert.strictEqual(enabled[0]?.metadata.id, 'traditional_rag');
    });

    it('enables and disables strategies dynamically', () => {
        const registry = new StrategyRegistry();
        registry.register(new SemanticSearchStrategy(undefined, false));

        assert.strictEqual(registry.getEnabled().length, 0);
        const enabled = registry.enable('semantic_search');
        assert.strictEqual(enabled, true);
        assert.strictEqual(registry.getEnabled().length, 1);

        const disabled = registry.disable('semantic_search');
        assert.strictEqual(disabled, true);
        assert.strictEqual(registry.getEnabled().length, 0);
    });

    it('validates dependencies strictly for graph-based strategies', () => {
        const registry = new StrategyRegistry({ enabled: true, mode: 'auto' }, { hasGraphStore: false });
        const graphAdapter = new MemoryGraphAdapter();

        // Registering graph strategy without graph adapter should fail dependency check
        const graphWithoutAdapter = new KnowledgeGraphStrategy(undefined, true);
        registry.register(graphWithoutAdapter);

        const validation = registry.validateDependencies('knowledge_graph');
        assert.strictEqual(validation.valid, false);
        assert.ok(validation.missingDependencies.includes('graphAdapter'));

        // Registering with graph adapter should pass dependency check
        const registry2 = new StrategyRegistry({ enabled: true, mode: 'auto' }, { hasGraphStore: true });
        const graphWithAdapter = new KnowledgeGraphStrategy(graphAdapter, true);
        registry2.register(graphWithAdapter);

        const validation2 = registry2.validateDependencies('knowledge_graph');
        assert.strictEqual(validation2.valid, true);
        assert.strictEqual(validation2.missingDependencies.length, 0);
    });

    it('resolves strategies by capability and category', () => {
        const registry = new StrategyRegistry();
        registry.register(new TraditionalRAGStrategy(undefined, true));
        registry.register(new SemanticSearchStrategy(undefined, true));
        registry.register(new CAGStrategy(undefined, true));

        const retrievers = registry.getByCategory('retrieval');
        assert.strictEqual(retrievers.length, 2);
        assert.ok(retrievers.some(r => r.metadata.id === 'semantic_search'));
        assert.ok(retrievers.some(r => r.metadata.id === 'traditional_rag'));

        const multiTenant = registry.findSupporting('supportsMultiTenant');
        assert.strictEqual(multiTenant.length, 3);
    });
});
