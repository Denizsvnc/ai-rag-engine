import type { IRulesAdapter } from '../../interfaces/rules.interface.js';

export type RuleInput = string | { id?: string; rule: string; [key: string]: any };

export class StaticRulesAdapter implements IRulesAdapter {
    private rules: string[];

    constructor(rules: Array<RuleInput> = []) {
        this.rules = rules.map(r => {
            if (typeof r === 'string') return r;
            if (r && typeof r === 'object' && typeof r.rule === 'string') return r.rule;
            return String(r);
        });
    }

    // Optional tenantId can be used for tenant-specific rules
    public async getActiveRules(tenantId?: string): Promise<string[]> {
        return this.rules;
    }
}