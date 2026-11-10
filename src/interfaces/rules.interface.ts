/**
 * Interface for business rules and compliance policy adapters.
 *
 * @remarks
 * Injected into system prompts to ensure LLM generations strictly adhere to corporate rules and policies.
 */
export interface IRulesAdapter {
    /**
     * Retrieves active rules and policy strings, optionally filtered by tenant.
     *
     * @param tenantId - Optional tenant identifier.
     * @returns Array of active rule strings.
     */
    getActiveRules(tenantId?: string): Promise<string[]>;
}
