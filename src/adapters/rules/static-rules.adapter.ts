import type { IRulesAdapter } from '../../interfaces/rules.interface.js';

/**
 * Union type representing rule entries passed to {@link StaticRulesAdapter}.
 */
export type RuleInput = string | { id?: string; rule: string; [key: string]: unknown };

/**
 * In-memory rules adapter providing static business constraints and prompt directives.
 *
 * @remarks
 * Implements {@link IRulesAdapter} to inject operational rules, safety guidelines,
 * and corporate policies into system prompts.
 *
 * @example
 * ```typescript
 * import { StaticRulesAdapter } from '@denizsvnc/ai-rag-engine';
 *
 * const rules = new StaticRulesAdapter([
 *   'Never provide medical advice.',
 *   'Always answer in Turkish if query is in Turkish.'
 * ]);
 *
 * const activeRules = await rules.getActiveRules();
 * ```
 */
export class StaticRulesAdapter implements IRulesAdapter {
    private rules: string[];

    /**
     * Initializes a new StaticRulesAdapter instance.
     *
     * @param rules - Array of string rules or rule objects.
     */
    constructor(rules: Array<RuleInput> = []) {
        this.rules = rules.map(r => {
            if (typeof r === 'string') return r;
            if (r && typeof r === 'object' && typeof r.rule === 'string') return r.rule;
            return String(r);
        });
    }

    /**
     * Retrieves active rules, optionally scoped to tenant.
     *
     * @param tenantId - Optional tenant identifier.
     * @returns Array of rule prompt directives.
     */
    public async getActiveRules(tenantId?: string): Promise<string[]> {
        return this.rules;
    }
}