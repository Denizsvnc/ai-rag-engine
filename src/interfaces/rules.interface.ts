export interface IRulesAdapter {
    getActiveRules(tenantId?: string): Promise<string[]>;
}
