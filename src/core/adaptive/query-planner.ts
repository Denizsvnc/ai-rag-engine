import type { StrategyId, StrategyExecutionContext } from '../../interfaces/strategy.interface.js';
import type { AdaptiveIntelligenceConfig, StrategyDecisionExplanation, AdaptiveExecutionMode } from '../../interfaces/adaptive-config.interface.js';
import type { StrategyRegistry } from './strategy-registry.js';

/**
 * Deterministic linguistic and structural signals extracted from a user query.
 */
export interface QuerySignals {
    /** True if exact alphanumeric codes, SKUs, or reference IDs are present. */
    hasExactIdentifiers: boolean;
    /** True if relational multi-hop keywords (connection, hierarchy, manager) are present. */
    hasMultiHopKeywords: boolean;
    /** True if rule, policy, constraint, or deduction keywords are present. */
    hasLogicalRuleKeywords: boolean;
    /** True if tool execution or mutation action verbs are present. */
    hasActionKeywords: boolean;
    /** True if concept clustering or thematic exploration keywords are present. */
    hasConceptualKeywords: boolean;
    /** Length of query string in characters. */
    queryLength: number;
    /** Fast heuristic token count estimate. */
    tokenCountEstimate: number;
}

/**
 * Deterministic query planner analyzing intent and routing queries to optimal strategies.
 *
 * @remarks
 * Evaluates linguistic signals, active mode ('auto', 'auto-hybrid', 'manual', 'fallback'),
 * cost/latency constraints, and store availability to produce a comprehensive execution plan
 * and explainability trace.
 *
 * @example
 * ```typescript
 * import { AdaptiveQueryPlanner, StrategyRegistry } from '@denizsvnc/ai-rag-engine';
 *
 * const registry = new StrategyRegistry();
 * const planner = new AdaptiveQueryPlanner({ enabled: true, mode: 'auto' }, registry);
 *
 * const decision = await planner.plan({
 *   query: 'Find connections between quantum computing and cryptography',
 *   tenantId: 'tenant_1'
 * });
 * console.log(decision.selectedStrategies); // ['graph_rag'] or ['hybrid_search']
 * ```
 */
export class AdaptiveQueryPlanner {
    // Deterministic routing signals supporting multi-lingual Turkish and English stems
    private static readonly EXACT_IDENTIFIER_REGEX = /(?:^|\s)([A-Z0-9]{3,}-[A-Z0-9]{2,}|TR\d{2}[0-9A-Z]{5,}|[A-Z]{2,}\d{3,}|\d{8,})(?:\s|$|[.,?!])/;
    private static readonly MULTI_HOP_REGEX = /(?:ilişki|bağlantı|zincir|kiminle|nasıl bağlı|related to|connection between|hierarchy|manager of|path from|network of|subordinate)/i;
    private static readonly KAG_LOGIC_REGEX = /(?:şart|kural|uygun|hak kazan|uyumlu|çelişki|eligible|compliance|violat|rule|constraint|satisf|deduce|policy logic)/i;
    private static readonly AGENTIC_ACTION_REGEX = /(?:güncelle|oluştur|sil|çalıştır|araştır ve bul|tara ve raporla|execute|update|create|delete|investigate and|order|perform)/i;
    private static readonly CONCEPTUAL_GRAPH_REGEX = /(?:kavram|tematik|benzer konular|kavram haritası|concept map|thematic cluster|related concepts)/i;

    /**
     * Initializes a new AdaptiveQueryPlanner instance.
     *
     * @param config - Adaptive intelligence configuration.
     * @param registry - Strategy registry containing registered strategies and status.
     */
    constructor(
        private readonly config: AdaptiveIntelligenceConfig,
        private readonly registry: StrategyRegistry
    ) {}

    /**
     * Extracts lightweight deterministic linguistic and structural signals from prompt.
     *
     * @param query - Raw query text.
     * @returns Extracted linguistic and structural signals.
     */
    public extractSignals(query: string): QuerySignals {
        const trimmed = query.trim();
        const words = trimmed.split(/\s+/);
        return {
            hasExactIdentifiers: AdaptiveQueryPlanner.EXACT_IDENTIFIER_REGEX.test(trimmed),
            hasMultiHopKeywords: AdaptiveQueryPlanner.MULTI_HOP_REGEX.test(trimmed),
            hasLogicalRuleKeywords: AdaptiveQueryPlanner.KAG_LOGIC_REGEX.test(trimmed),
            hasActionKeywords: AdaptiveQueryPlanner.AGENTIC_ACTION_REGEX.test(trimmed),
            hasConceptualKeywords: AdaptiveQueryPlanner.CONCEPTUAL_GRAPH_REGEX.test(trimmed),
            queryLength: trimmed.length,
            tokenCountEstimate: Math.ceil(words.length * 1.3)
        };
    }

    /**
     * Plans and selects the appropriate strategy set based on query signals, configuration,
     * available infrastructure, and resource limits.
     *
     * @param context - Strategy execution context.
     * @returns Full decision explanation containing selected strategies, rejected strategies, costs, and audit reasons.
     */
    public async plan(context: StrategyExecutionContext): Promise<StrategyDecisionExplanation> {
        const signals = this.extractSignals(context.query);
        const mode: AdaptiveExecutionMode = (context.metadata?.requestedMode as AdaptiveExecutionMode | undefined) || this.config.mode || 'auto';
        const availableStrategies = await this.registry.getAvailableStrategies(context);
        const availableIds = new Set(availableStrategies.map(s => s.metadata.id));

        const selectedStrategies: StrategyId[] = [];
        const rejectedStrategies: Array<{ strategyId: StrategyId; reason: string }> = [];
        const reasons: string[] = [];

        // Check all registered strategies to record rejection reasons if unavailable/disabled
        for (const strategy of this.registry.getAll()) {
            const id = strategy.metadata.id;
            if (!this.registry.isStrategyPermitted(id, context.metadata?.requestedStrategy as StrategyId | undefined)) {
                rejectedStrategies.push({ strategyId: id, reason: 'Disabled by system/tenant policy or configuration' });
            } else if (!availableIds.has(id)) {
                rejectedStrategies.push({ strategyId: id, reason: 'Prerequisites or backend store unavailable' });
            }
        }

        // 1. Manual Execution Mode: enforce single requested strategy
        if (mode === 'manual') {
            const requested = context.metadata?.requestedStrategy as StrategyId | undefined;
            if (requested && availableIds.has(requested)) {
                selectedStrategies.push(requested);
                reasons.push(`Manual mode: executed explicitly requested strategy '${requested}'`);
            } else if (availableStrategies.length > 0) {
                const fallbackStrategy = availableStrategies[0]!.metadata.id;
                selectedStrategies.push(fallbackStrategy);
                reasons.push(`Manual mode: requested strategy not available; defaulted to highest priority '${fallbackStrategy}'`);
            }
        } 
        // 2. Auto-Hybrid Execution Mode: select primary + complementary strategies for parallel evidence collection
        else if (mode === 'auto-hybrid') {
            const maxParallel = this.config.maxParallelOperations ?? 3;

            // Decide complementary pair/trio based on signals
            if (signals.hasMultiHopKeywords && availableIds.has('graph_rag')) {
                selectedStrategies.push('graph_rag');
                reasons.push('Multi-hop relational question detected -> selected graph_rag');
            }
            if (signals.hasLogicalRuleKeywords && availableIds.has('kag')) {
                selectedStrategies.push('kag');
                reasons.push('Rule/compliance deduction detected -> selected kag');
            }
            if (signals.hasExactIdentifiers && availableIds.has('hybrid_search')) {
                selectedStrategies.push('hybrid_search');
                reasons.push('Exact identifier detected -> selected hybrid_search');
            } else if (availableIds.has('semantic_search') && !selectedStrategies.includes('hybrid_search')) {
                selectedStrategies.push('semantic_search');
                reasons.push('Dense semantic grounding -> selected semantic_search');
            }

            // Fill up to maxParallel from top priority available strategies if needed
            for (const strat of availableStrategies) {
                if (selectedStrategies.length >= maxParallel) break;
                const id = strat.metadata.id;
                if (!selectedStrategies.includes(id)) {
                    selectedStrategies.push(id);
                    reasons.push(`Priority fill: added complementary '${id}'`);
                }
            }
        }
        // 3. Fallback Mode: prioritize sequential fallback chain
        else if (mode === 'fallback') {
            const chain = this.config.fallbackChain || ['hybrid_search', 'traditional_rag', 'semantic_search'];
            for (const id of chain) {
                if (availableIds.has(id)) {
                    selectedStrategies.push(id);
                    reasons.push(`Fallback mode: added strategy '${id}' to execution order`);
                }
            }
            if (selectedStrategies.length === 0 && availableStrategies.length > 0) {
                selectedStrategies.push(availableStrategies[0]!.metadata.id);
            }
        }
        // 4. Auto Mode: pick the single highest-fidelity strategy for the query
        else {
            if (signals.hasActionKeywords && availableIds.has('agentic_rag')) {
                selectedStrategies.push('agentic_rag');
                reasons.push('Action/mutation or multi-step execution query -> selected agentic_rag');
            } else if (signals.hasLogicalRuleKeywords && availableIds.has('kag')) {
                selectedStrategies.push('kag');
                reasons.push('Compliance/rule evaluation query -> selected kag');
            } else if (signals.hasMultiHopKeywords && availableIds.has('graph_rag')) {
                selectedStrategies.push('graph_rag');
                reasons.push('Multi-entity relational query -> selected graph_rag');
            } else if (signals.hasConceptualKeywords && availableIds.has('semantic_graph')) {
                selectedStrategies.push('semantic_graph');
                reasons.push('Concept exploration query -> selected semantic_graph');
            } else if (signals.hasExactIdentifiers && availableIds.has('hybrid_search')) {
                selectedStrategies.push('hybrid_search');
                reasons.push('Exact term or identifier present -> selected hybrid_search');
            } else if (availableIds.has('hybrid_search')) {
                selectedStrategies.push('hybrid_search');
                reasons.push('Standard query -> selected hybrid_search as primary balanced retriever');
            } else if (availableIds.has('semantic_search')) {
                selectedStrategies.push('semantic_search');
                reasons.push('Standard query -> selected semantic_search');
            } else if (availableStrategies.length > 0) {
                selectedStrategies.push(availableStrategies[0]!.metadata.id);
                reasons.push(`Defaulted to highest priority available strategy '${selectedStrategies[0]}'`);
            }
        }

        // Final safety check: if no strategy was selected, fallback to traditional_rag or first available
        if (selectedStrategies.length === 0) {
            if (availableIds.has('traditional_rag')) {
                selectedStrategies.push('traditional_rag');
            } else if (availableStrategies.length > 0) {
                selectedStrategies.push(availableStrategies[0]!.metadata.id);
            }
            reasons.push('Fallback to baseline available retrieval strategy');
        }

        // Calculate estimated cost and latency
        let estimatedCost = 0;
        let estimatedLatencyMs = 0;
        for (const id of selectedStrategies) {
            const strat = this.registry.get(id);
            if (strat) {
                estimatedCost += strat.estimateCost(context);
                estimatedLatencyMs = Math.max(estimatedLatencyMs, strat.estimateLatency(context));
            }
        }

        // Calculate fallback chain
        const fallbackChain: StrategyId[] = [];
        for (const strat of availableStrategies) {
            const id = strat.metadata.id;
            if (!selectedStrategies.includes(id)) {
                fallbackChain.push(id);
            }
        }

        // Calibrate confidence (bounded [0.5 - 0.98])
        const confidence = Math.min(0.98, Math.max(0.60, 0.70 + (selectedStrategies.length > 0 ? 0.20 : 0.0)));

        return {
            selectedStrategies,
            rejectedStrategies,
            mode,
            reasons,
            confidence,
            estimatedCost,
            estimatedLatencyMs,
            fallbackChain
        };
    }
}
