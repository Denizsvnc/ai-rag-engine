import { z } from 'zod';
import type { QueryContext } from './query-context.interface';

export interface ToolParameterSchema {
    type: 'object';
    properties: Record<string, {
        type: 'string' | 'number' | 'boolean' | 'array';
        description: string;
        enum?: string[];
    }>;
    required?: string[];
}

export interface IAgentTool<TArgs = any, TResult = any> {
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
     * If true, execution requires context.confirmedAction === true.
     */
    requiresConfirmation?: boolean | undefined;

    /**
     * The business logic function to execute.
     */
    execute: (args: TArgs, context?: QueryContext) => Promise<TResult>;
}

export interface ToolAuditLog {
    timestamp: string;
    toolName: string;
    tenantId?: string | undefined;
    userId?: string | undefined;
    args: any;
    isMutating: boolean;
    status: 'SUCCESS' | 'VALIDATION_FAILED' | 'UNAUTHORIZED' | 'CONFIRMATION_REQUIRED' | 'EXECUTION_FAILED';
    error?: string | undefined;
    durationMs: number;
}