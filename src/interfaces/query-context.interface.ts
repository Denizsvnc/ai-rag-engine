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
    metadata?: Record<string, any> | undefined;

    /**
     * Set to true to bypass cache lookup.
     */
    skipCache?: boolean | undefined;

    /**
     * Explicit confirmation flag for mutating or destructive operations (legacy / dev).
     */
    confirmedAction?: boolean | undefined;

    /**
     * Cryptographically signed HMAC-SHA256 confirmation ticket for destructive/mutating operations (P0 security).
     */
    confirmationTicket?: string | undefined;
}
