import type { IAgentTool, ToolAuditLog } from '../../interfaces/tool.interface.js';
import type { QueryContext } from '../../interfaces/query-context.interface.js';
import { ConfirmationService } from './confirmation.js';
import type { ConfirmationNonceStore } from './nonce-store.js';
import { z } from 'zod';

/**
 * Execution request provided to the centralized GovernedToolExecutor.
 */
export interface GovernedToolExecutionRequest {
    /** Target tool to execute. */
    tool: IAgentTool;
    /** Raw or extracted arguments for the tool. */
    arguments?: Record<string, unknown> | undefined;
    /** Caller query and security context. */
    context?: QueryContext | undefined;
    /** Confirmation service for issuing/verifying mutation tickets. */
    confirmationService?: ConfirmationService | undefined;
    /** Cryptographic secret for confirmation ticket HMAC validation. */
    confirmationSecret?: string | undefined;
    /** Single-use nonce store preventing ticket replays. */
    nonceStore?: ConfirmationNonceStore | undefined;
    /** Optional tenant permission allowlist mapping tenantId -> allowed tool names. */
    tenantPermissions?: Record<string, string[]> | undefined;
    /** Execution timeout in milliseconds (default: 10,000ms). */
    timeoutMs?: number | undefined;
    /** Cancellation signal. */
    signal?: AbortSignal | undefined;
    /** Audit recorder callback for security logging. */
    auditRecorder?: ((log: ToolAuditLog) => unknown) | undefined;
}

/**
 * Observable outcome of governed tool execution.
 */
export type GovernedToolExecutionResult =
    | { status: 'SUCCESS'; data: unknown; durationMs: number }
    | { status: 'UNAUTHORIZED'; error: string; durationMs: number }
    | { status: 'VALIDATION_FAILED'; error: string; details?: unknown; durationMs: number }
    | { status: 'CONFIRMATION_REQUIRED'; confirmationTicket: string; proposedArgs: Record<string, unknown>; message: string; durationMs: number }
    | { status: 'TIMEOUT'; error: string; durationMs: number }
    | { status: 'CANCELLED'; error: string; durationMs: number }
    | { status: 'EXECUTION_FAILED'; error: string; durationMs: number };

/**
 * Centralized, reusable, secure tool execution boundary enforcing 10 mandatory security gates.
 *
 * @remarks
 * Used by RAGEngine traditional tool calls, AgenticRAGStrategy, AdaptiveOrchestrator,
 * and external tool invocation paths to eliminate authorization and schema bypasses.
 */
export class GovernedToolExecutor {
    private static readonly SENSITIVE_KEY_PATTERN = /^(password|secret|token|apiKey|authorization|creditCard|tckn|cvv|privateKey)$/i;

    /**
     * Executes a tool under all 10 mandatory security gates.
     *
     * @param request - Execution parameters and caller security context.
     * @returns Structured outcome with deterministic status.
     */
    public static async execute(request: GovernedToolExecutionRequest): Promise<GovernedToolExecutionResult> {
        const startTime = Date.now();
        const { tool, context, signal, timeoutMs = 10_000 } = request;

        // Helper to record audit log with secret redaction
        const recordAudit = (
            status: ToolAuditLog['status'],
            args: unknown,
            error?: string
        ): void => {
            if (request.auditRecorder) {
                request.auditRecorder({
                    timestamp: new Date().toISOString(),
                    toolName: tool?.name || 'unknown_tool',
                    tenantId: context?.tenantId,
                    userId: context?.userId,
                    args: GovernedToolExecutor.redactSecrets(args),
                    isMutating: Boolean(tool?.isMutating || tool?.requiresConfirmation),
                    status,
                    ...(error ? { error } : {}),
                    durationMs: Date.now() - startTime
                });
            }
        };

        // Gate 1: Verify tool identity & executable integrity
        if (!tool || typeof tool.name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(tool.name) || typeof tool.execute !== 'function') {
            const err = 'Invalid, malformed, or unregistered tool definition.';
            recordAudit('EXECUTION_FAILED', request.arguments, err);
            return { status: 'EXECUTION_FAILED', error: err, durationMs: Date.now() - startTime };
        }

        // Gate 2: Validate caller identity and trusted tenant context
        if (!context || !context.tenantId || typeof context.tenantId !== 'string' || context.tenantId.trim().length === 0) {
            const err = `Caller tenant context is required for governed tool execution: "${tool.name}".`;
            recordAudit('UNAUTHORIZED', request.arguments, err);
            return { status: 'UNAUTHORIZED', error: err, durationMs: Date.now() - startTime };
        }

        // Gate 3: Enforce RBAC and authorization policy
        if (tool.requiredRoles && tool.requiredRoles.length > 0) {
            const callerRoles = context.roles || [];
            const hasPermission = tool.requiredRoles.some(role => callerRoles.includes(role));
            if (!hasPermission) {
                const err = `User "${context.userId || 'anonymous'}" lacks required role(s): [${tool.requiredRoles.join(', ')}] for tool "${tool.name}".`;
                recordAudit('UNAUTHORIZED', request.arguments, err);
                return { status: 'UNAUTHORIZED', error: err, durationMs: Date.now() - startTime };
            }
        }

        // Gate 4: Validate tool arguments using Zod or declared schema (Fail-closed)
        let validatedArgs: Record<string, unknown> = (request.arguments as Record<string, unknown>) || {};
        const effectiveSchema: z.ZodSchema | undefined =
            tool.zodSchema || ('schema' in tool ? (tool as { schema?: z.ZodSchema }).schema : undefined);

        if (effectiveSchema) {
            const parseResult = effectiveSchema.safeParse(validatedArgs);
            if (!parseResult.success) {
                const err = `Argument validation failed: Invalid tool arguments for tool "${tool.name}": ${parseResult.error.message}`;
                recordAudit('VALIDATION_FAILED', validatedArgs, err);
                return {
                    status: 'VALIDATION_FAILED',
                    error: err,
                    details: parseResult.error.issues,
                    durationMs: Date.now() - startTime
                };
            }
            validatedArgs = (parseResult.data as Record<string, unknown>) || {};
        }

        // Gate 5: Enforce tenant-specific tool permissions
        if (request.tenantPermissions) {
            const allowedTools = request.tenantPermissions[context.tenantId];
            if (Array.isArray(allowedTools) && !allowedTools.includes(tool.name)) {
                const err = `Tool "${tool.name}" is not permitted for tenant "${context.tenantId}".`;
                recordAudit('UNAUTHORIZED', validatedArgs, err);
                return { status: 'UNAUTHORIZED', error: err, durationMs: Date.now() - startTime };
            }
        }

        // Gate 6: Verify mutation classification
        const isMutatingOperation = Boolean(tool.isMutating || tool.requiresConfirmation);

        // Gate 7 & Gate 8: Cryptographic confirmation & single-use nonce for mutating operations
        if (isMutatingOperation) {
            let isConfirmed = false;
            let confirmationError: string | undefined;

            if (context.confirmationTicket) {
                const ticketCheck = await ConfirmationService.verifyTicket(
                    context.confirmationTicket,
                    tool.name,
                    validatedArgs,
                    context,
                    request.confirmationSecret,
                    request.nonceStore
                );
                if (ticketCheck.valid) {
                    isConfirmed = true;
                } else {
                    confirmationError = ticketCheck.error;
                }
            }

            if (!isConfirmed) {
                const confirmationService = request.confirmationService || new ConfirmationService(
                    request.confirmationSecret
                );
                const ticket = confirmationService.issueTicket(tool.name, validatedArgs, context);
                const warnMsg = confirmationError ||
                    `Tool "${tool.name}" mutates state and requires user confirmation. Submit the provided confirmation ticket to proceed.`;

                recordAudit('CONFIRMATION_REQUIRED', validatedArgs, warnMsg);
                return {
                    status: 'CONFIRMATION_REQUIRED',
                    confirmationTicket: ticket,
                    proposedArgs: validatedArgs,
                    message: warnMsg,
                    durationMs: Date.now() - startTime
                };
            }
        }

        // Gate 9: Apply timeout and cancellation
        if (signal?.aborted) {
            const err = `Tool execution cancelled before invocation: ${signal.reason || 'Operation aborted.'}`;
            recordAudit('CANCELLED', validatedArgs, err);
            return { status: 'CANCELLED', error: err, durationMs: Date.now() - startTime };
        }

        const timeoutController = new AbortController();
        const combinedSignal = signal;
        let timer: NodeJS.Timeout | undefined;

        try {
            const timeoutPromise = new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                    timeoutController.abort(new Error(`Tool execution timed out after ${timeoutMs}ms.`));
                    reject(new Error(`Tool execution timed out after ${timeoutMs}ms.`));
                }, timeoutMs);
            });

            // Execute the business logic
            const executionPromise = tool.execute(validatedArgs, {
                ...context,
                signal: combinedSignal
            });

            const data = await Promise.race([executionPromise, timeoutPromise]);
            if (timer) clearTimeout(timer);

            // Gate 10: Record security audit event with secret redaction
            recordAudit('SUCCESS', validatedArgs);
            return { status: 'SUCCESS', data, durationMs: Date.now() - startTime };
        } catch (e: unknown) {
            if (timer) clearTimeout(timer);
            const isTimeout = timeoutController.signal.aborted || (e instanceof Error && e.message.includes('timed out'));
            const isCancelled = signal?.aborted;

            const errMsg = e instanceof Error ? e.message : String(e);

            if (isCancelled) {
                recordAudit('CANCELLED', validatedArgs, errMsg);
                return { status: 'CANCELLED', error: errMsg, durationMs: Date.now() - startTime };
            }
            if (isTimeout) {
                recordAudit('TIMEOUT', validatedArgs, errMsg);
                return { status: 'TIMEOUT', error: errMsg, durationMs: Date.now() - startTime };
            }

            recordAudit('EXECUTION_FAILED', validatedArgs, errMsg);
            return { status: 'EXECUTION_FAILED', error: errMsg, durationMs: Date.now() - startTime };
        }
    }

    /**
     * Recursively redacts sensitive values (passwords, tokens, API keys, TCKN, credit cards).
     *
     * @param value - Arbitrary payload to sanitize for audit logs.
     * @returns Deep copy with sensitive properties masked as `[REDACTED]`.
     */
    public static redactSecrets(value: unknown): unknown {
        if (!value || typeof value !== 'object') {
            return value;
        }

        if (Array.isArray(value)) {
            return value.map(item => GovernedToolExecutor.redactSecrets(item));
        }

        const redacted: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
            if (GovernedToolExecutor.SENSITIVE_KEY_PATTERN.test(key)) {
                redacted[key] = '[REDACTED]';
            } else if (typeof val === 'object' && val !== null) {
                redacted[key] = GovernedToolExecutor.redactSecrets(val);
            } else {
                redacted[key] = val;
            }
        }
        return redacted;
    }
}
