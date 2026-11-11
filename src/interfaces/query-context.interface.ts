/**
 * Multi-tenant and user execution context for queries and tool actions.
 */
export interface QueryContext {
    /**
     * Unique identifier of the tenant / organization (for multi-tenant isolation).
     */
    tenantId?: string | undefined;

    /**
     * Unique identifier of the requesting user.
     */
    userId?: string | undefined;

    /**
     * RBAC roles assigned to the requesting user (e.g. ['admin', 'manager', 'read_only']).
     */
    roles?: string[] | undefined;

    /**
     * Arbitrary contextual metadata passed through the pipeline.
     */
    metadata?: Record<string, unknown> | undefined;

    /**
     * Set to true to bypass cache lookup.
     */
    skipCache?: boolean | undefined;

    /**
     * @deprecated Ignored. Mutations require a signed confirmationTicket.
     */
    confirmedAction?: boolean | undefined;

    /**
     * Cryptographically signed HMAC-SHA256 confirmation ticket for destructive/mutating operations (P0 security).
     */
    confirmationTicket?: string | undefined;

    /**
     * Optional abort signal for latency deadline or client cancellation.
     */
    signal?: AbortSignal | undefined;

    /**
     * Optional strategy request-level overrides.
     * Note: Cannot re-enable strategies disabled by tenant or system security policy.
     */
    adaptiveOverrides?: {
        strategy?: import('./strategy.interface.js').StrategyId | undefined;
        mode?: import('./adaptive-config.interface.js').AdaptiveExecutionMode | undefined;
        maxHops?: number | undefined;
        topK?: number | undefined;
    } | undefined;
}
