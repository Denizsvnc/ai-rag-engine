import type { IRulesAdapter } from '../../interfaces/rules.interface';

export class StaticRulesAdapter implements IRulesAdapter {
    private rules: string[];

    constructor(rules: string[]) {
        this.rules = rules;
    }

    // Optional tenantId can be used for tenant-specific rules
    public async getActiveRules(tenantId?: string): Promise<string[]> {
        return this.rules;
    }
}