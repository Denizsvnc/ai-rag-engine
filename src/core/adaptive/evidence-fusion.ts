import type { EvidenceItem, FusedEvidenceContext, EvidenceFusionConfig, ContradictionReport } from '../../interfaces/evidence.interface.js';
import type { StrategyExecutionResult, StrategyId } from '../../interfaces/strategy.interface.js';

/**
 * Fusion engine performing multi-strategy evidence deduplication, RRF ranking, and contradiction detection.
 *
 * @remarks
 * Combines evidence from different retrieval strategies (dense vectors, sparse lexical, knowledge graphs,
 * rule deduction) using weighted Reciprocal Rank Fusion (RRF), enforces token budget constraints, generates
 * structured citations, and flags conflicting factual statements.
 *
 * @example
 * ```typescript
 * import { EvidenceFusionEngine } from '@denizsvnc/ai-rag-engine';
 *
 * const fusionEngine = new EvidenceFusionEngine({
 *   reciprocalRankK: 60,
 *   maxContextTokens: 2000,
 *   detectContradictions: true
 * });
 *
 * const fused = fusionEngine.fuse(strategyResults);
 * console.log(fused.contextString);
 * ```
 */
export class EvidenceFusionEngine {
    /**
     * Initializes a new EvidenceFusionEngine instance.
     *
     * @param config - Evidence fusion configuration options.
     */
    constructor(private readonly config?: EvidenceFusionConfig) {}

    /**
     * Fuses multi-strategy evidence items into a deduplicated, calibrated, and ranked context.
     *
     * @param results - Array of execution results from individual strategies.
     * @returns Fused context object with ranked items, formatted context string, citations, and contradiction reports.
     */
    public fuse(results: StrategyExecutionResult[]): FusedEvidenceContext {
        const strategyWeights = this.config?.strategyWeights || {};
        const rrfK = this.config?.reciprocalRankK ?? 60;
        const maxTokens = this.config?.maxContextTokens ?? 2500;

        // 1. Collect all valid evidence items from successful strategies
        const allItems: EvidenceItem[] = [];
        for (const res of results) {
            if (res.success && res.evidence && res.evidence.length > 0) {
                allItems.push(...res.evidence);
            }
        }

        if (allItems.length === 0) {
            return {
                items: [],
                contextString: '',
                citations: [],
                contradictions: [],
                coverageRatio: 0.0
            };
        }

        // 2. Multi-Strategy Reciprocal Rank Fusion & Deduplication
        // Key: [tenantId, sourceDocId, sourceChunkId || 'doc']
        const fusedMap = new Map<
            string,
            {
                item: EvidenceItem;
                combinedRrfScore: number;
                contributingStrategies: Set<StrategyId>;
                traversalPaths: string[][];
            }
        >();

        // Rank items per strategy
        const strategyBuckets = new Map<StrategyId, EvidenceItem[]>();
        for (const item of allItems) {
            const list = strategyBuckets.get(item.strategyId) || [];
            list.push(item);
            strategyBuckets.set(item.strategyId, list);
        }

        for (const [stratId, items] of strategyBuckets.entries()) {
            const weight = strategyWeights[stratId] ?? 1.0;
            // Sort items within strategy by score descending
            items.sort((a, b) => b.score - a.score);

            items.forEach((item, index) => {
                const rank = index + 1;
                const rrfContribution = weight / (rrfK + rank);
                const key = `${item.tenantId}::${item.sourceDocId}::${item.sourceChunkId || item.id}`;

                const existing = fusedMap.get(key);
                if (existing) {
                    existing.combinedRrfScore += rrfContribution;
                    existing.contributingStrategies.add(stratId);
                    if (item.traversalPath) existing.traversalPaths.push(item.traversalPath);
                    // Keep the content with highest detail or score
                    if (item.content.length > existing.item.content.length) {
                        existing.item.content = item.content;
                    }
                } else {
                    fusedMap.set(key, {
                        item: { ...item },
                        combinedRrfScore: rrfContribution,
                        contributingStrategies: new Set([stratId]),
                        traversalPaths: item.traversalPath ? [item.traversalPath] : []
                    });
                }
            });
        }

        // 3. Sort fused items by combined RRF score descending
        const fusedEntries = Array.from(fusedMap.values());
        fusedEntries.sort((a, b) => b.combinedRrfScore - a.combinedRrfScore);

        // Normalize fused score to [0.0 - 1.0]
        const maxRrf = fusedEntries[0]?.combinedRrfScore || 1.0;
        const normalizedItems: EvidenceItem[] = fusedEntries.map(entry => {
            const item = entry.item;
            item.score = Math.min(1.0, entry.combinedRrfScore / maxRrf);
            if (entry.traversalPaths.length > 0) {
                item.traversalPath = entry.traversalPaths.flat();
            }
            return item;
        });

        // 4. Assemble context string bounded by token budget
        let estimatedTokens = 0;
        const contextParts: string[] = [];
        const citations: FusedEvidenceContext['citations'] = [];
        const includedItems: EvidenceItem[] = [];

        for (let i = 0; i < normalizedItems.length; i++) {
            const item = normalizedItems[i]!;
            const itemTokens = Math.ceil(item.content.split(/\s+/).length * 1.3);

            if (estimatedTokens + itemTokens > maxTokens && contextParts.length > 0) {
                break;
            }

            const citationIdx = contextParts.length + 1;
            contextParts.push(`[${citationIdx}] (${item.evidenceType} via ${item.strategyId}): ${item.content}`);
            citations.push({
                index: citationIdx,
                docId: item.sourceDocId,
                chunkId: item.sourceChunkId,
                strategy: item.strategyId,
                snippet: item.content.slice(0, 160)
            });

            includedItems.push(item);
            estimatedTokens += itemTokens;
        }

        // 5. Contradiction Detection across fused items
        const contradictions: ContradictionReport[] = [];
        if (this.config?.detectContradictions !== false) {
            for (let i = 0; i < includedItems.length; i++) {
                for (let j = i + 1; j < includedItems.length; j++) {
                    const a = includedItems[i]!;
                    const b = includedItems[j]!;
                    const contradiction = this.checkContradiction(a, b);
                    if (contradiction) {
                        contradictions.push(contradiction);
                    }
                }
            }
        }

        const coverageRatio = Math.min(1.0, includedItems.length / Math.max(1, results.length));

        return {
            items: includedItems,
            contextString: contextParts.join('\n\n'),
            citations,
            contradictions,
            coverageRatio
        };
    }

    private checkContradiction(a: EvidenceItem, b: EvidenceItem): ContradictionReport | null {
        const textA = a.content.toLowerCase();
        const textB = b.content.toLowerCase();

        // Check for affirmative vs explicit negative claims on identical keywords
        const negWords = ['değil', 'yok', 'yasak', 'not', 'never', 'prohibited', 'false', 'cannot'];
        const aHasNeg = negWords.some(w => textA.includes(w));
        const bHasNeg = negWords.some(w => textB.includes(w));

        // If one contains negative polarity and they share high word overlap (>= 4 words)
        if (aHasNeg !== bHasNeg) {
            const wordsA = new Set(textA.split(/\s+/).filter(w => w.length > 3));
            let common = 0;
            for (const w of textB.split(/\s+/)) {
                if (wordsA.has(w)) common++;
            }
            if (common >= 4) {
                return {
                    detected: true,
                    conflictingEvidenceIds: [a.id, b.id],
                    reason: `Polarity conflict detected between evidence '${a.id}' and '${b.id}' on shared terms`,
                    severity: 'warning'
                };
            }
        }

        return null;
    }
}

