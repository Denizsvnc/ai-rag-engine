import type { AdaptiveIntelligenceConfig } from '../../interfaces/adaptive-config.interface.js';
import type { StrategyExecutionContext, IStrategy } from '../../interfaces/strategy.interface.js';
import type { RAGResponse } from '../../interfaces/engine-config.interface.js';
import type { ILLMProvider } from '../../interfaces/llm.interface.js';
import { StrategyRegistry, type StrategyRegistryDependencies } from './strategy-registry.js';
import { AdaptiveQueryPlanner } from './query-planner.js';
import { ExecutionScheduler } from './execution-scheduler.js';
import { EvidenceFusionEngine } from './evidence-fusion.js';

// Strategy implementations
import { TraditionalRAGStrategy } from './strategies/traditional-rag.strategy.js';
import { SemanticSearchStrategy } from './strategies/semantic-search.strategy.js';
import { HybridSearchStrategy } from './strategies/hybrid-search.strategy.js';
import { SemanticGraphStrategy } from './strategies/semantic-graph.strategy.js';
import { KnowledgeGraphStrategy } from './strategies/knowledge-graph.strategy.js';
import { GraphRAGStrategy } from './strategies/graph-rag.strategy.js';
import { KAGStrategy } from './strategies/kag.strategy.js';
import { CAGStrategy } from './strategies/cag.strategy.js';
import { AgenticRAGStrategy } from './strategies/agentic-rag.strategy.js';

/**
 * Dependencies injected into the `AdaptiveIntelligenceOrchestrator` to instantiate enabled strategies.
 */
export interface AdaptiveDependencies {
    /** Vector store adapter for semantic and dense retrieval. */
    vectorStore?: import('../../interfaces/vector.interface.js').IVectorStoreAdapter | undefined;
    /** Graph storage adapter for Knowledge Graph, Semantic Graph, and GraphRAG. */
    graphStore?: import('../../interfaces/graph.interface.js').IGraphAdapter | undefined;
    /** Tool registry for Agentic RAG action execution. */
    toolRegistry?: import('../tool-registry.js').ToolRegistry | null | undefined;
    /** Cache adapter for Cache-Augmented Generation (CAG). */
    cacheAdapter?: import('../../interfaces/cache.interface.js').ICacheAdapter | undefined;
    /** Business rules adapter for Knowledge-Augmented Generation (KAG). */
    rulesAdapter?: import('../../interfaces/rules.interface.js').IRulesAdapter | undefined;
}

/**
 * Top-level orchestrator for the Adaptive Multi-Strategy Intelligence Architecture.
 *
 * @remarks
 * Dynamically plans query execution across 9 strategies:
 * `traditional_rag`, `cag`, `kag`, `semantic_graph`, `knowledge_graph`, `graph_rag`,
 * `semantic_search`, `hybrid_search`, and `agentic_rag`.
 *
 * Coordinates execution via `AdaptiveQueryPlanner`, bounds concurrency via `ExecutionScheduler`,
 * fuses multi-source evidence using `EvidenceFusionEngine`, and generates grounded answers.
 */
export class AdaptiveIntelligenceOrchestrator {
    private readonly registry: StrategyRegistry;
    private readonly planner: AdaptiveQueryPlanner;
    private readonly scheduler: ExecutionScheduler;
    private readonly fusionEngine: EvidenceFusionEngine;

    constructor(
        private readonly config: AdaptiveIntelligenceConfig,
        deps: AdaptiveDependencies
    ) {
        const registryDeps: StrategyRegistryDependencies = {
            hasVectorStore: !!deps.vectorStore,
            hasGraphStore: !!deps.graphStore,
            hasToolRegistry: !!deps.toolRegistry,
            hasCacheAdapter: !!deps.cacheAdapter,
            hasRulesAdapter: !!deps.rulesAdapter
        };

        this.registry = new StrategyRegistry(config, registryDeps);
        this.planner = new AdaptiveQueryPlanner(config, this.registry);
        this.scheduler = new ExecutionScheduler(config, this.registry);
        this.fusionEngine = new EvidenceFusionEngine(config.fusion);

        this.initializeStrategies(deps);
    }

    private initializeStrategies(deps: AdaptiveDependencies): void {
        const isStrategyConfigured = (id: import('../../interfaces/strategy.interface.js').StrategyId): boolean => {
            const setting = this.config.strategies?.[id];
            if (setting === undefined) return true; // Enabled by default unless specified
            return typeof setting === 'boolean' ? setting : setting.enabled ?? true;
        };

        // 1. Traditional RAG
        if (deps.vectorStore && isStrategyConfigured('traditional_rag')) {
            this.registry.register(new TraditionalRAGStrategy(deps.vectorStore, true));
        }

        // 2. Semantic Search
        if (deps.vectorStore && isStrategyConfigured('semantic_search')) {
            this.registry.register(new SemanticSearchStrategy(deps.vectorStore, true));
        }

        // 3. Hybrid Search
        if (deps.vectorStore && isStrategyConfigured('hybrid_search')) {
            this.registry.register(new HybridSearchStrategy(deps.vectorStore, true));
        }

        // 4. Semantic Graph
        if (deps.graphStore && isStrategyConfigured('semantic_graph')) {
            this.registry.register(new SemanticGraphStrategy(deps.graphStore, true));
        }

        // 5. Knowledge Graph
        if (deps.graphStore && isStrategyConfigured('knowledge_graph')) {
            this.registry.register(new KnowledgeGraphStrategy(deps.graphStore, true));
        }

        // 6. GraphRAG
        if (deps.graphStore && deps.vectorStore && isStrategyConfigured('graph_rag')) {
            this.registry.register(new GraphRAGStrategy(deps.graphStore, deps.vectorStore, true));
        }

        // 7. KAG
        if ((deps.rulesAdapter || deps.graphStore) && isStrategyConfigured('kag')) {
            this.registry.register(new KAGStrategy(deps.rulesAdapter, deps.graphStore, deps.vectorStore, true));
        }

        // 8. CAG
        if (deps.cacheAdapter && isStrategyConfigured('cag')) {
            this.registry.register(new CAGStrategy(deps.cacheAdapter, true));
        }

        // 9. Agentic RAG
        if (deps.toolRegistry && isStrategyConfigured('agentic_rag')) {
            this.registry.register(new AgenticRAGStrategy(deps.toolRegistry, true));
        }
    }

    /**
     * Retrieves the internal strategy registry.
     *
     * @returns The active `StrategyRegistry` instance.
     */
    public getRegistry(): StrategyRegistry {
        return this.registry;
    }

    /**
     * Retrieves the adaptive query planner instance.
     *
     * @returns The active `AdaptiveQueryPlanner` instance.
     */
    public getPlanner(): AdaptiveQueryPlanner {
        return this.planner;
    }

    /**
     * Executes the complete adaptive query lifecycle: Plan -> Schedule -> Fuse -> Generate.
     *
     * @param userPrompt - User query text.
     * @param context - Execution context with tenant identity, budget limits, and deadlines.
     * @param llmProvider - LLM provider used for grounded answer generation.
     * @returns Promise resolving to `RAGResponse` with strategy decisions and structured evidence.
     */
    public async processQuery(
        userPrompt: string,
        context: StrategyExecutionContext,
        llmProvider: ILLMProvider
    ): Promise<RAGResponse> {
        const startTime = Date.now();

        // 1. Adaptive Query Planning
        const decision = await this.planner.plan(context);

        // 2. Bounded Concurrent Execution of Selected Strategies
        const executionResults = await this.scheduler.execute(decision.selectedStrategies, context);

        // 3. Multi-Strategy Evidence Fusion & Calibrated Ranking
        const fusedContext = this.fusionEngine.fuse(executionResults);

        // Check if CAG produced an immediate answer draft
        const cagResult = executionResults.find(r => r.strategyId === 'cag' && r.answerDraft);
        if (cagResult && cagResult.answerDraft) {
            return {
                answer: cagResult.answerDraft,
                intent: 'ADAPTIVE_INTELLIGENCE',
                resolvedBy: 'CacheAugmentedGeneration',
                sources: ['cag_cache'],
                latencyMs: Date.now() - startTime,
                strategyDecision: decision,
                evidence: fusedContext.items
            };
        }

        // 4. LLM Synthesis with Grounded Multi-Strategy Context
        let answer = '';
        if (fusedContext.contextString.trim().length > 0) {
            const llmRes = await llmProvider.generate({
                systemPrompt: 'You are an enterprise AI assistant. Based strictly on the verified multi-strategy evidence provided below, answer the user\'s question. If evidence is insufficient, state that clearly.',
                userPrompt: `EVIDENCE CONTEXT:\n${fusedContext.contextString}\n\nUSER QUESTION:\n${userPrompt}\n\nGROUNDED ANSWER (with citations):`
            });
            answer = llmRes.content;
        } else {
            answer = 'Yeterli doğrulanmış kurumsal bilgi bulunamadı.';
        }

        const sources = Array.from(new Set(fusedContext.citations.map(c => c.docId)));

        return {
            answer,
            intent: 'ADAPTIVE_INTELLIGENCE',
            resolvedBy: `AdaptiveOrchestrator(${decision.selectedStrategies.join('+')})`,
            sources,
            latencyMs: Date.now() - startTime,
            strategyDecision: decision,
            evidence: fusedContext.items
        };
    }
}
