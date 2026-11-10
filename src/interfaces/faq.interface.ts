/**
 * Standard FAQ entry containing a question-answer pair and optional precomputed embedding.
 */
export interface FAQItem {
    /** Unique identifier of the FAQ item. */
    id?: string | undefined;
    /** Tenant identifier for multi-tenant isolation. */
    tenantId?: string | undefined;
    /** FAQ question text. */
    question: string;
    /** Authoritative FAQ answer. */
    answer: string;
    /** Optional category tag (e.g. 'billing', 'shipping', 'legal'). */
    category?: string | undefined;
    /** Optional precomputed vector embedding. */
    embedding?: number[] | undefined;
}

/**
 * Result returned when a query semantically matches an authoritative FAQ.
 */
export interface FAQMatchResult {
    /** Matched FAQ question. */
    question: string;
    /** Answer text to serve immediately without an LLM call. */
    answer: string;
    /** Cosine similarity score in range [0.0 - 1.0]. */
    score: number;
}

/**
 * Interface for FAQ storage and semantic lookup adapters (e.g. `LocalFaqAdapter`, `UrlFaqAdapter`).
 */
export interface IFAQAdapter {
    /** Retrieves all FAQ items, optionally scoped to a specific tenant. */
    getFaqs(tenantId?: string): Promise<FAQItem[]>;
    /**
     * Finds the closest semantic FAQ match for a given query above a threshold.
     *
     * @param query - User question to match.
     * @param threshold - Minimum cosine similarity score.
     * @param tenantId - Optional tenant identifier to prevent cross-tenant FAQ leakage.
     */
    findBestMatch?(query: string, threshold?: number, tenantId?: string): Promise<FAQMatchResult | null>;
}