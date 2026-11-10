import type { IStrategy, StrategyId, StrategyExecutionContext } from '../../interfaces/strategy.interface.js';
import type { AdaptiveIntelligenceConfig } from '../../interfaces/adaptive-config.interface.js';

/**
 * Dependency availability flags required by strategies in the registry.
 */
export interface StrategyRegistryDependencies {
    /** True if a vector store adapter is configured. */
    hasVectorStore: boolean;
    /** True if a graph store adapter is configured. */
    hasGraphStore: boolean;
    /** True if a tool registry is configured. */
    hasToolRegistry: boolean;
    /** True if a cache adapter is configured. */
    hasCacheAdapter: boolean;
    /** True if a rules adapter is configured. */
    hasRulesAdapter: boolean;
}

/**
 * Registry and lifecycle manager for all retrieval and reasoning strategies.
 *
 * @remarks
 * Validates dependencies at initialization, tracks active overrides, checks runtime
 * availability, and prioritizes strategies based on configuration and baseline weights.
 *
 * @example
 * ```typescript
 * import { StrategyRegistry } from '@denizsvnc/ai-rag-engine';
 *
 * const registry = new StrategyRegistry({ enabled: true, mode: 'auto' });
 * const available = await registry.getAvailableStrategies({
 *   query: 'Find policy documents',
 *   tenantId: 'tenant_1'
 * });
 * ```
 */
export class StrategyRegistry {
    private strategies = new Map<StrategyId, IStrategy>();

    /**
     * Initializes a new StrategyRegistry instance and validates configuration.
     *
     * @param config - Adaptive intelligence configuration.
     * @param deps - Infrastructure dependency availability flags.
     * @throws If an enabled strategy lacks its required backing adapter.
     */
    constructor(
        private readonly config: AdaptiveIntelligenceConfig = { enabled: true, mode: 'auto' },
        private readonly deps: Partial<StrategyRegistryDependencies> = {}
    ) {
        this.validateConfiguration();
    }

    /**
     * Registers a strategy implementation in the registry.
     *
     * @param strategy - Strategy instance implementing {@link IStrategy}.
     */
    public register(strategy: IStrategy): void {
        this.strategies.set(strategy.metadata.id, strategy);
    }

    /**
     * Retrieves a registered strategy by identifier.
     *
     * @param id - Strategy identifier.
     * @returns Strategy instance if registered, otherwise undefined.
     */
    public get(id: StrategyId): IStrategy | undefined {
        return this.strategies.get(id);
    }

    /**
     * Checks if a strategy identifier is registered.
     *
     * @param id - Strategy identifier.
     * @returns True if registered.
     */
    public has(id: StrategyId): boolean {
        return this.strategies.has(id);
    }

    private overrides = new Map<StrategyId, boolean>();

    /**
     * Returns all registered strategy instances.
     *
     * @returns Array of registered strategies.
     */
    public getAll(): IStrategy[] {
        return Array.from(this.strategies.values());
    }

    /**
     * Returns all currently enabled strategies.
     *
     * @returns Array of enabled strategies taking manual overrides into account.
     */
    public getEnabled(): IStrategy[] {
        return Array.from(this.strategies.values()).filter(s => {
            if (this.overrides.has(s.metadata.id)) return this.overrides.get(s.metadata.id)!;
            return s.isEnabled();
        });
    }

    /**
     * Enables a registered strategy dynamically.
     *
     * @param id - Strategy identifier.
     * @returns True if successfully enabled, false if not registered.
     */
    public enable(id: StrategyId): boolean {
        if (!this.strategies.has(id)) return false;
        this.overrides.set(id, true);
        return true;
    }

    /**
     * Disables a registered strategy dynamically.
     *
     * @param id - Strategy identifier.
     * @returns True if successfully disabled, false if not registered.
     */
    public disable(id: StrategyId): boolean {
        if (!this.strategies.has(id)) return false;
        this.overrides.set(id, false);
        return true;
    }

    /**
     * Filters strategies by capability category.
     *
     * @param category - Category name ('vector', 'knowledge', 'cache', 'agent', etc.).
     * @returns Matching strategies.
     */
    public getByCategory(category: string): IStrategy[] {
        return Array.from(this.strategies.values()).filter(s => s.metadata.category === category);
    }

    /**
     * Finds all strategies supporting a specific capability flag.
     *
     * @param feature - Metadata property key.
     * @returns Strategies supporting the feature.
     */
    public findSupporting(feature: keyof import('../../interfaces/strategy.interface.js').StrategyCapabilityMetadata): IStrategy[] {
        return Array.from(this.strategies.values()).filter(s => Boolean(s.metadata[feature]));
    }

    /**
     * Validates whether all infrastructure dependencies of a strategy are satisfied.
     *
     * @param strategyId - Strategy identifier.
     * @returns Validation outcome with list of missing dependencies.
     */
    public validateDependencies(strategyId: StrategyId): { valid: boolean; missingDependencies: string[] } {
        const strategy = this.strategies.get(strategyId);
        const missing: string[] = [];
        if (!strategy) return { valid: false, missingDependencies: ['strategy_not_registered'] };

        if (strategy.metadata.requiresGraphIndex && !this.deps?.hasGraphStore) {
            missing.push('graphAdapter');
        }
        if (strategy.metadata.requiresVectorStore && !this.deps?.hasVectorStore) {
            missing.push('vectorStore');
        }
        if (strategy.metadata.requiresToolRegistry && !this.deps?.hasToolRegistry) {
            missing.push('toolRegistry');
        }

        return {
            valid: missing.length === 0,
            missingDependencies: missing
        };
    }

    /**
     * Enforces dependency validity and configuration constraints.
     * Fails fast with clear actionable errors if a requested strategy lacks required infrastructure.
     */
    private validateConfiguration(): void {
        const strategySettings = this.config?.strategies || {};

        for (const [key, setting] of Object.entries(strategySettings)) {
            const strategyId = key as StrategyId;
            const isEnabled = typeof setting === 'boolean' ? setting : setting?.enabled ?? false;
            if (!isEnabled) continue;

            if ((strategyId === 'graph_rag' || strategyId === 'knowledge_graph' || strategyId === 'semantic_graph') && !this.deps?.hasGraphStore) {
                throw new Error(
                    `[StrategyRegistry] Configuration Error: Strategy '${strategyId}' is enabled but no graph adapter is configured in inputs.graph.`
                );
            }

            if (strategyId === 'agentic_rag' && !this.deps?.hasToolRegistry) {
                throw new Error(
                    `[StrategyRegistry] Configuration Error: Strategy 'agentic_rag' is enabled but no tools were configured in engineConfig.tools.`
                );
            }

            if ((strategyId === 'hybrid_search' || strategyId === 'semantic_search' || strategyId === 'traditional_rag') && !this.deps?.hasVectorStore) {
                throw new Error(
                    `[StrategyRegistry] Configuration Error: Strategy '${strategyId}' is enabled but no vectorStore is configured in inputs.vectorStore.`
                );
            }
        }
    }

    /**
     * Determines whether a specific strategy is permitted and available to run.
     * Hierarchy: System security > Tenant policy > Application config > Context request override.
     *
     * @param strategyId - Target strategy ID.
     * @param requestedOverride - Optional strategy requested by query metadata.
     * @returns True if strategy is permitted to execute.
     */
    public isStrategyPermitted(strategyId: StrategyId, requestedOverride?: StrategyId): boolean {
        const setting = this.config.strategies?.[strategyId];
        const isGloballyEnabled = typeof setting === 'boolean' ? setting : setting?.enabled ?? true;

        // If explicitly disabled in config, overrides CANNOT re-enable it (Security Invariant)
        if (!isGloballyEnabled) {
            return false;
        }

        if (this.config.mode === 'manual' && requestedOverride) {
            return requestedOverride === strategyId;
        }

        return true;
    }

    /**
     * Retrieves all strategies that are currently permitted, registered, and available.
     *
     * @param context - Execution context to test against.
     * @returns Promise resolving to sorted list of available strategies in descending priority order.
     */
    public async getAvailableStrategies(context: StrategyExecutionContext): Promise<IStrategy[]> {
        const permitted: IStrategy[] = [];

        for (const strategy of this.strategies.values()) {
            const id = strategy.metadata.id;
            if (!this.isStrategyPermitted(id, context.metadata?.requestedStrategy as StrategyId | undefined)) {
                continue;
            }

            try {
                const available = await strategy.isAvailable(context);
                if (available) {
                    permitted.push(strategy);
                }
            } catch {
                // Ignore unavailable strategy
            }
        }

        // Sort by configured priority descending
        return permitted.sort((a, b) => {
            const pA = this.getPriority(a.metadata.id);
            const pB = this.getPriority(b.metadata.id);
            return pB - pA;
        });
    }

    /**
     * Calculates the execution priority weight for a strategy.
     *
     * @param strategyId - Strategy identifier.
     * @returns Priority number (higher values execute first).
     */
    public getPriority(strategyId: StrategyId): number {
        const configuredPriority = this.config.priorities?.[strategyId];
        if (typeof configuredPriority === 'number') return configuredPriority;

        const specific = this.config.strategies?.[strategyId];
        if (typeof specific === 'object' && typeof specific?.priority === 'number') {
            return specific.priority;
        }

        // Baseline sensible defaults
        const defaults: Record<StrategyId, number> = {
            cag: 100,             // Fast cache hit first
            semantic_search: 80,
            hybrid_search: 75,
            traditional_rag: 70,
            knowledge_graph: 65,
            semantic_graph: 60,
            graph_rag: 55,
            kag: 50,
            agentic_rag: 40       // High-cost multi-step agent last
        };

        return defaults[strategyId] ?? 50;
    }
}
