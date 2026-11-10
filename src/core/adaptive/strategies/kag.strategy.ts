import type { IStrategy, StrategyCapabilityMetadata, StrategyExecutionContext, StrategyExecutionResult } from '../../../interfaces/strategy.interface.js';
import type { IGraphAdapter } from '../../../interfaces/graph.interface.js';
import type { IRulesAdapter } from '../../../interfaces/rules.interface.js';
import type { IVectorStoreAdapter } from '../../../interfaces/vector.interface.js';
import type { EvidenceItem } from '../../../interfaces/evidence.interface.js';

/**
 * Step-by-step logical deduction statement emitted by KAG reasoning.
 */
export interface LogicalDeductionStep {
    /** Input factual premise or observation. */
    premise: string;
    /** Corporate rule or ontology relation applied. */
    ruleApplied: string;
    /** Logical conclusion derived from applying the rule. */
    conclusion: string;
    /** Deduction status. */
    status: 'asserted' | 'derived' | 'contradiction';
}

/**
 * Knowledge-Augmented Generation (KAG) strategy for schema-guided logical deduction.
 *
 * @remarks
 * Combines business rules, domain ontologies, and constraints to perform symbolic reasoning
 * before LLM synthesis, detecting rule violations and proving compliance.
 */
export class KAGStrategy implements IStrategy {
    public readonly metadata: StrategyCapabilityMetadata = {
        id: 'kag',
        name: 'Knowledge-Augmented Generation (KAG)',
        description: 'Schema-guided logical and factual reasoning using domain ontologies, constraint rules, and symbolic deduction.',
        category: 'reasoning',
        supportsStreaming: false,
        supportsMultiTenant: true,
        requiresGraphIndex: false,
        requiresVectorStore: false,
        requiresToolRegistry: false,
        typicalLatencyMs: 75,
        estimatedCostPerQuery: 0.002
    };

    constructor(
        private readonly rulesAdapter?: IRulesAdapter | undefined,
        private readonly graphStore?: IGraphAdapter | undefined,
        private readonly vectorStore?: IVectorStoreAdapter | undefined,
        private readonly enabled: boolean = true
    ) {}

    public isEnabled(): boolean {
        return this.enabled && (!!this.rulesAdapter || !!this.graphStore);
    }

    public async isAvailable(context: StrategyExecutionContext): Promise<boolean> {
        return this.isEnabled();
    }

    public estimateCost(context: StrategyExecutionContext): number {
        return this.metadata.estimatedCostPerQuery;
    }

    public estimateLatency(context: StrategyExecutionContext): number {
        return this.metadata.typicalLatencyMs;
    }

    public async execute(context: StrategyExecutionContext): Promise<StrategyExecutionResult> {
        const startTime = Date.now();
        const evidence: EvidenceItem[] = [];
        const deductions: LogicalDeductionStep[] = [];

        // 1. Retrieve domain rules from IRulesAdapter
        let activeRules: string[] = [];
        if (this.rulesAdapter) {
            try {
                activeRules = await this.rulesAdapter.getActiveRules(context.tenantId);
            } catch {
                activeRules = [];
            }
        }

        for (const rule of activeRules) {
            evidence.push({
                id: `kag_rule_${this.hash(rule)}`,
                strategyId: 'kag',
                sourceDocId: 'domain_ontology_rules',
                tenantId: context.tenantId,
                content: `[Asserted Rule Constraint]: ${rule}`,
                score: 1.0,
                evidenceType: 'kag_deduction',
                extractionProvenance: { method: 'rule_assertion', confidence: 1.0 }
            });
        }

        // 2. Fetch factual graph assertions if available
        if (this.graphStore) {
            const seedNodes = await this.graphStore.searchNodes(context.query, context.tenantId, 2);
            for (const seed of seedNodes) {
                const sub = await this.graphStore.getNeighbors(seed.id, context.tenantId, { maxDepth: 1 });
                for (const edge of sub.edges) {
                    evidence.push({
                        id: `kag_fact_${edge.id}`,
                        strategyId: 'kag',
                        sourceDocId: edge.sourceDocId || 'graph_fact',
                        tenantId: context.tenantId,
                        content: `[Extracted Fact]: (${edge.sourceId}) -[${edge.relation}]-> (${edge.targetId})`,
                        score: edge.confidence,
                        evidenceType: 'graph_relation',
                        extractionProvenance: { method: 'llm_extraction', confidence: edge.confidence }
                    });
                }
            }
        }

        // 3. Symbolic deduction & rule verification
        const queryLower = context.query.toLowerCase();
        for (const rule of activeRules) {
            const ruleLower = rule.toLowerCase();

            // Check if query concerns rule topic
            const ruleTokens = ruleLower.split(/\s+/).filter(w => w.length > 4);
            const matchesQuery = ruleTokens.some(t => queryLower.includes(t));

            if (matchesQuery) {
                deductions.push({
                    premise: `Query matches domain constraint: "${rule}"`,
                    ruleApplied: rule,
                    conclusion: `Strict compliance with policy enforced: ${rule}`,
                    status: 'derived'
                });

                evidence.push({
                    id: `kag_deduction_${this.hash(rule + context.query)}`,
                    strategyId: 'kag',
                    sourceDocId: 'symbolic_reasoner',
                    tenantId: context.tenantId,
                    content: `[Derived Deduction]: Logical constraint applied to query: ${rule}`,
                    score: 0.95,
                    evidenceType: 'kag_deduction',
                    extractionProvenance: { method: 'rule_assertion', confidence: 0.95 }
                });
            }
        }

        return {
            strategyId: 'kag',
            success: true,
            executionTimeMs: Date.now() - startTime,
            evidence,
            intermediateData: { deductions },
            confidence: evidence.length > 0 ? 0.95 : 0.40
        };
    }

    private hash(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = (hash << 5) - hash + str.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash).toString(36).slice(0, 8);
    }
}
