import type { IStrategy, StrategyCapabilityMetadata, StrategyExecutionContext, StrategyExecutionResult } from '../../../interfaces/strategy.interface.js';
import type { ToolRegistry } from '../../tool-registry.js';
import type { EvidenceItem } from '../../../interfaces/evidence.interface.js';
import type { IAgentTool } from '../../../interfaces/tool.interface.js';
import type { QueryContext } from '../../../interfaces/query-context.interface.js';
import { GovernedToolExecutor } from '../../security/governed-tool-executor.js';

/**
 * Strategy performing autonomous bounded tool execution and reasoning.
 *
 * @remarks
 * Discovers and executes read-only tools registered in {@link ToolRegistry}.
 * Mutating or confirmation-requiring tools are intentionally shielded; their requirement
 * is logged into evidence without invocation until authorized via cryptographic confirmation ticket.
 *
 * @example
 * ```typescript
 * import { AgenticRAGStrategy, ToolRegistry } from '@denizsvnc/ai-rag-engine';
 *
 * const toolRegistry = new ToolRegistry();
 * const strategy = new AgenticRAGStrategy(toolRegistry);
 *
 * const result = await strategy.execute({
 *   query: 'Check current inventory for SKU 9876',
 *   tenantId: 'tenant_main'
 * });
 * ```
 */
export class AgenticRAGStrategy implements IStrategy {
    /**
     * Capability metadata declaring tool requirements, latency, and costs.
     */
    public readonly metadata: StrategyCapabilityMetadata = {
        id: 'agentic_rag',
        name: 'Agentic RAG',
        description: 'Multi-step autonomous retrieval and reasoning agent utilizing governed tools under strict RBAC and confirmation limits.',
        category: 'agent',
        supportsStreaming: true,
        supportsMultiTenant: true,
        requiresGraphIndex: false,
        requiresVectorStore: false,
        requiresToolRegistry: true,
        typicalLatencyMs: 250,
        estimatedCostPerQuery: 0.005
    };

    /**
     * Creates an instance of AgenticRAGStrategy.
     *
     * @param toolRegistry - Governed tool registry instance.
     * @param enabled - Whether agentic retrieval is enabled.
     */
    constructor(
        private readonly toolRegistry?: ToolRegistry | null | undefined,
        private readonly enabled: boolean = true
    ) {}

    /**
     * Checks if the strategy is enabled and tool registry is configured.
     *
     * @returns True if enabled with active tool registry.
     */
    public isEnabled(): boolean {
        return this.enabled && !!this.toolRegistry;
    }

    /**
     * Evaluates runtime availability against context.
     *
     * @param context - Execution context.
     * @returns Promise resolving to true if strategy can run.
     */
    public async isAvailable(context: StrategyExecutionContext): Promise<boolean> {
        return this.isEnabled();
    }

    /**
     * Estimates monetary cost in USD per query execution.
     *
     * @param context - Execution context.
     * @returns Estimated cost.
     */
    public estimateCost(context: StrategyExecutionContext): number {
        return this.metadata.estimatedCostPerQuery;
    }

    /**
     * Estimates expected latency in milliseconds.
     *
     * @param context - Execution context.
     * @returns Typical latency in ms.
     */
    public estimateLatency(context: StrategyExecutionContext): number {
        return this.metadata.typicalLatencyMs;
    }

    /**
     * Executes bounded agentic retrieval using governed ToolRegistry.
     * Enforces strict tool boundaries: mutating tools still require confirmation tickets.
     */
    public async execute(context: StrategyExecutionContext): Promise<StrategyExecutionResult> {
        const startTime = Date.now();
        if (!this.toolRegistry) {
            return {
                strategyId: 'agentic_rag',
                success: false,
                executionTimeMs: 0,
                evidence: [],
                confidence: 0,
                error: 'Agentic RAG requires an initialized ToolRegistry.'
            };
        }

        const maxToolCalls = 5;
        const evidence: EvidenceItem[] = [];
        let executedCallsCount = 0;

        // Discover tools matching intent
        const matchingTools: IAgentTool[] = [];
        try {
            const candidateTool = await this.toolRegistry.routeQueryToTool(context.query, 0.5);
            if (candidateTool) {
                matchingTools.push(candidateTool);
            }
        } catch {
            // SML route fallback
        }

        const allTools = this.toolRegistry.getAllTools();
        for (const t of allTools) {
            if (!matchingTools.some(m => m.name === t.name)) {
                const qLower = context.query.toLowerCase();
                if (qLower.includes(t.name.toLowerCase()) || (t.description && qLower.includes(t.description.toLowerCase().slice(0, 15)))) {
                    matchingTools.push(t);
                }
            }
        }

        for (const tool of matchingTools) {
            if (executedCallsCount >= maxToolCalls) break;
            if (context.signal?.aborted) throw context.signal.reason || new Error('Aborted');

            const qContext: QueryContext = {
                tenantId: context.tenantId,
                userId: context.userId,
                roles: context.roles,
                metadata: { query: context.query }
            };

            const outcome = await GovernedToolExecutor.execute({
                tool,
                arguments: {},
                context: qContext,
                signal: context.signal,
                timeoutMs: 5_000
            });

            if (outcome.status === 'SUCCESS') {
                executedCallsCount++;
                evidence.push({
                    id: `agentic_tool_${tool.name}_${Date.now()}`,
                    strategyId: 'agentic_rag',
                    sourceDocId: `tool_${tool.name}`,
                    tenantId: context.tenantId,
                    content: `Tool Execution [${tool.name}]: ${JSON.stringify(outcome.data)}`,
                    score: 0.90,
                    evidenceType: 'tool_output',
                    extractionProvenance: { method: 'tool_execution', confidence: 0.90 },
                    metadata: { toolName: tool.name }
                });
            } else if (outcome.status === 'CONFIRMATION_REQUIRED') {
                evidence.push({
                    id: `agentic_mutating_${tool.name}`,
                    strategyId: 'agentic_rag',
                    sourceDocId: `tool_${tool.name}`,
                    tenantId: context.tenantId,
                    content: `Mutating Tool [${tool.name}] identified but blocked pending cryptographic confirmation ticket.`,
                    score: 0.85,
                    evidenceType: 'tool_output',
                    metadata: { toolName: tool.name, requiresConfirmation: true, confirmationTicket: outcome.confirmationTicket }
                });
            } else {
                // Failure isolation & boundary enforcement (UNAUTHORIZED, VALIDATION_FAILED, TIMEOUT, CANCELLED, EXECUTION_FAILED)
                evidence.push({
                    id: `agentic_tool_${outcome.status.toLowerCase()}_${tool.name}`,
                    strategyId: 'agentic_rag',
                    sourceDocId: `tool_${tool.name}`,
                    tenantId: context.tenantId,
                    content: `Tool Execution [${tool.name}] Blocked or Failed (${outcome.status}): ${outcome.error}`,
                    score: 0.10,
                    evidenceType: 'tool_output',
                    metadata: { toolName: tool.name, error: true, status: outcome.status }
                });
            }
        }

        return {
            strategyId: 'agentic_rag',
            success: true,
            executionTimeMs: Date.now() - startTime,
            evidence,
            confidence: evidence.length > 0 ? 0.88 : 0.25,
            telemetry: { toolCallsCount: executedCallsCount }
        };
    }
}
