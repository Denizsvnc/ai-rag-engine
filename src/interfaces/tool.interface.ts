import { z } from 'zod';
import type { QueryContext } from './query-context.interface.js';

/**
 * JSON Schema definition for tool parameters used in function-calling LLMs.
 */
export interface ToolParameterSchema {
    type: 'object';
    properties: Record<string, {
        type: 'string' | 'number' | 'boolean' | 'array';
        description: string;
        enum?: string[];
    }>;
    required?: string[];
}

/**
 * Enterprise contract for governed agent tools.
 *
 * @remarks
 * Tools can be semantically routed using `SMLEngine` embeddings or invoked by function-calling LLMs.
 * Features built-in RBAC (`requiredRoles`), Zod validation (`zodSchema`), and cryptographic mutation tickets (`requiresConfirmation`).
 *
 * @typeParam TArgs - Type of arguments accepted by the tool execute function.
 * @typeParam TResult - Return type of the tool execution.
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import type { IAgentTool } from '@denizsvnc/ai-rag-engine';
 *
 * const checkStockTool: IAgentTool<{ sku: string }, { inStock: number }> = {
 *   name: 'check_stock',
 *   description: 'Checks current stock count in inventory for a product SKU.',
 *   zodSchema: z.object({ sku: z.string().min(3) }),
 *   isMutating: false,
 *   execute: async ({ sku }) => ({ inStock: 42 })
 * };
 * ```
 */
export interface IAgentTool<TArgs = Record<string, unknown>, TResult = unknown> {
    name: string;
    description: string; // Used by SML for intent routing and vector similarity
    parameters?: ToolParameterSchema | undefined;
    cacheResultTTL?: number | undefined;

    /**
     * Optional Zod schema for strict runtime validation of arguments before execution.
     */
    zodSchema?: z.ZodSchema<TArgs> | undefined;

    /**
     * Flag declaring if this tool mutates system state (e.g. updating stock, making payments).
     * If true, requires explicit confirmation or appropriate permissions.
     */
    isMutating?: boolean | undefined;

    /**
     * Role-Based Access Control: List of roles allowed to invoke this tool.
     * If defined, caller context.roles must include at least one matching role.
     */
    requiredRoles?: string[] | undefined;

    /**
     * If true, execution requires a valid single-use context.confirmationTicket.
     */
    requiresConfirmation?: boolean | undefined;

    /**
     * The business logic function to execute.
     */
    execute(args: TArgs, context?: QueryContext): Promise<TResult>;
}

export interface ToolAuditLog {
    timestamp: string;
    toolName: string;
    tenantId?: string | undefined;
    userId?: string | undefined;
    args: unknown;
    isMutating: boolean;
    status: 'SUCCESS' | 'VALIDATION_FAILED' | 'UNAUTHORIZED' | 'CONFIRMATION_REQUIRED' | 'EXECUTION_FAILED';
    error?: string | undefined;
    durationMs: number;
}