import type { StrategyId } from './strategy.interface.js';

/**
 * Semantic type discriminator for structured multi-strategy evidence.
 */
export type EvidenceType =
    | 'text_chunk'
    | 'graph_entity'
    | 'graph_relation'
    | 'graph_path'
    | 'cached_prefix'
    | 'kag_deduction'
    | 'tool_output';

/**
 * Normalized evidence item retrieved by any strategy and presented to the fusion engine.
 */
export interface EvidenceItem {
    /** Unique identifier of the evidence item. */
    id: string;
    /** Originating strategy ID. */
    strategyId: StrategyId;
    /** Source document ID or tool identifier. */
    sourceDocId: string;
    /** Specific chunk identifier if originating from a partitioned document. */
    sourceChunkId?: string | undefined;
    /** Revision or epoch of the source document. */
    sourceRevision?: number | string | undefined;
    /** Tenant identifier for multi-tenant isolation. */
    tenantId: string;
    /** Text content snippet or statement. */
    content: string;
    /** Normalized relevance score in range [0.0 - 1.0]. */
    score: number;
    /** Raw, unnormalized strategy-specific score (cosine similarity, BM25 score, RRF rank). */
    rawScore?: number | undefined;
    /** Semantic discriminator conforming to `EvidenceType`. */
    evidenceType: EvidenceType;
    /** Provenance trail detailing how this evidence was extracted. */
    extractionProvenance?: {
        method?: 'llm_extraction' | 'rule_assertion' | 'vector_cosine' | 'bm25_lexical' | 'tool_execution' | undefined;
        model?: string | undefined;
        extractedAt?: number | undefined;
        confidence?: number | undefined;
        ruleId?: string | undefined;
    } | undefined;
    /** Graph traversal node sequence if retrieved via graph traversal. */
    traversalPath?: string[] | undefined;
    /** Arbitrary strategy-specific metadata. */
    metadata?: Record<string, unknown> | undefined;
}

/**
 * Contradiction report emitted when conflicting evidence statements are detected across strategies.
 */
export interface ContradictionReport {
    /** Whether an active factual or policy contradiction was detected. */
    detected: boolean;
    /** Pair of conflicting evidence item IDs. */
    conflictingEvidenceIds: [string, string];
    /** Explanation of the contradiction. */
    reason: string;
    /** Severity level of the contradiction. */
    severity: 'warning' | 'critical';
}

/**
 * Fused context assembled from multiple strategies for LLM answer generation.
 */
export interface FusedEvidenceContext {
    /** Ranked, deduplicated evidence items within token budget. */
    items: EvidenceItem[];
    /** Fully formatted evidence context prompt string. */
    contextString: string;
    /** Structured citations linking statements to source documents. */
    citations: Array<{
        index: number;
        docId: string;
        chunkId?: string | undefined;
        strategy: StrategyId;
        snippet: string;
    }>;
    /** Array of detected contradictory claims. */
    contradictions: ContradictionReport[];
    /** Estimated query intent coverage ratio in range [0.0 - 1.0]. */
    coverageRatio: number;
}

/**
 * Configuration options for the Evidence Fusion Engine.
 */
export interface EvidenceFusionConfig {
    /** Maximum token budget allowed for the fused context prompt. Defaults to 4000. */
    maxContextTokens?: number | undefined;
    /** Custom priority weights assigned to strategies during RRF fusion. */
    strategyWeights?: Partial<Record<StrategyId, number>> | undefined;
    /** Reciprocal Rank Fusion constant k. Defaults to 60. */
    reciprocalRankK?: number | undefined;
    /** Deduplication threshold to discard redundant chunks. */
    deduplicationThreshold?: number | undefined;
    /** Whether to detect and report conflicting evidence claims. Defaults to `true`. */
    detectContradictions?: boolean | undefined;
}

