import crypto from 'crypto';
import { z } from 'zod';
import { resolveSecret } from './secrets.js';
import { MemoryConfirmationNonceStore, type ConfirmationNonceStore } from './nonce-store.js';
import type { QueryContext } from '../../interfaces/query-context.interface.js';

const ticketPayloadSchema = z.object({
    toolName: z.string().min(1), argsHash: z.string().regex(/^[a-f0-9]{64}$/),
    tenantId: z.string().min(1).optional(), userId: z.string().min(1).optional(),
    nonce: z.uuid(), expiresAt: z.number().int().positive()
});

/**
 * Decoded payload of a cryptographic confirmation ticket for sensitive tool mutations.
 */
export interface ConfirmationTicketPayload {
    /** Target tool name authorized for execution. */
    toolName: string;
    /** Deterministic SHA-256 hash of the canonicalized arguments. */
    argsHash: string;
    /** Tenant ID claiming the mutation. */
    tenantId?: string | undefined;
    /** User ID who approved the mutation. */
    userId?: string | undefined;
    /** Single-use UUID nonce preventing replay attacks. */
    nonce: string;
    /** Epoch timestamp in ms when the ticket expires. */
    expiresAt: number;
}

/**
 * Target tool and context parameters required to issue or verify a confirmation ticket.
 */
export interface TicketTargetOptions {
    /** The target tool name. */
    toolName: string;
    /** Arguments proposed for execution. */
    args: unknown;
    /** Tenant identifier. */
    tenantId?: string | undefined;
    /** User identifier. */
    userId?: string | undefined;
}

/**
 * Cryptographic service issuing and validating single-use HMAC-SHA256 confirmation tickets.
 *
 * @remarks
 * Used by Agentic RAG and Governed Tools to ensure mutating or high-risk actions (e.g. money transfers,
 * database deletes, stock updates) require explicit user authorization before execution.
 *
 * @example
 * ```typescript
 * const confirmation = new ConfirmationService(process.env.CONFIRMATION_SECRET);
 * const ticket = confirmation.issueTicket({
 *   toolName: 'cancel_subscription',
 *   args: { subId: 'sub_123' },
 *   tenantId: 'tenant_acme'
 * });
 * const verification = await confirmation.verifyTicket(ticket, {
 *   toolName: 'cancel_subscription',
 *   args: { subId: 'sub_123' },
 *   tenantId: 'tenant_acme'
 * });
 * ```
 */
export class ConfirmationService {
    private static readonly memoryStore = new MemoryConfirmationNonceStore();
    private static readonly DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

    constructor(
        private secret: string = resolveSecret('CONFIRMATION_SECRET'),
        private ttlMs: number = ConfirmationService.DEFAULT_TTL_MS,
        private nonceStore: ConfirmationNonceStore = ConfirmationService.memoryStore
    ) {
        this.secret = resolveSecret('CONFIRMATION_SECRET', secret);
        if (process.env.NODE_ENV === 'production' && !nonceStore.distributed) {
            throw new Error('Production confirmation requires a distributed nonce store.');
        }
    }

    /**
     * Instance method to issue a ticket using the configured secret and TTL.
     */
    public issueTicket(options: TicketTargetOptions): string;
    public issueTicket(toolName: string, args: unknown, context?: QueryContext): string;
    public issueTicket(optionsOrName: TicketTargetOptions | string, maybeArgs?: unknown, maybeContext?: QueryContext): string {
        if (typeof optionsOrName === 'object') {
            return ConfirmationService.issueTicket(
                optionsOrName.toolName,
                optionsOrName.args,
                { tenantId: optionsOrName.tenantId, userId: optionsOrName.userId } as QueryContext,
                this.ttlMs,
                this.secret
            );
        }
        return ConfirmationService.issueTicket(optionsOrName, maybeArgs, maybeContext, this.ttlMs, this.secret);
    }

    /**
     * Instance method to verify a ticket. Throws an Error on verification failure.
     */
    public verifyTicket(ticket: string, options: TicketTargetOptions): Promise<{ valid: boolean; payload?: ConfirmationTicketPayload }>;
    public verifyTicket(ticket: string, toolName: string, args: unknown, context?: QueryContext): Promise<{ valid: boolean; payload?: ConfirmationTicketPayload }>;
    public async verifyTicket(
        ticket: string,
        optionsOrName: TicketTargetOptions | string,
        maybeArgs?: unknown,
        maybeContext?: QueryContext
    ): Promise<{ valid: boolean; payload?: ConfirmationTicketPayload }> {
        let toolName: string;
        let args: unknown;
        let context: QueryContext | undefined;

        if (typeof optionsOrName === 'object') {
            toolName = optionsOrName.toolName;
            args = optionsOrName.args;
            context = { tenantId: optionsOrName.tenantId, userId: optionsOrName.userId } as QueryContext;
        } else {
            toolName = optionsOrName;
            args = maybeArgs;
            context = maybeContext;
        }

        const result = await ConfirmationService.verifyTicket(ticket, toolName, args, context, this.secret, this.nonceStore);
        if (!result.valid) {
            throw new Error(result.error || 'Ticket verification failed.');
        }
        return { valid: true };
    }

    /**
     * Produces a deterministic canonical JSON string for arguments regardless of key order.
     */
    public static canonicalize(data: unknown): string {
        if (data === null || typeof data !== 'object') {
            return JSON.stringify(data);
        }
        if (Array.isArray(data)) {
            return '[' + data.map(v => this.canonicalize(v)).join(',') + ']';
        }
        const sortedKeys = Object.keys(data as Record<string, unknown>).sort();
        const parts = sortedKeys.map(k => `${JSON.stringify(k)}:${this.canonicalize((data as Record<string, unknown>)[k])}`);
        return '{' + parts.join(',') + '}';
    }

    /**
     * Computes SHA-256 hash of canonicalized tool arguments.
     */
    public static hashArgs(args: unknown): string {
        const canonical = this.canonicalize(args || {});
        return crypto.createHash('sha256').update(canonical).digest('hex');
    }

    /**
     * Issues a cryptographically signed, short-lived, single-use ticket for a proposed mutating tool invocation.
     */
    public static issueTicket(
        toolName: string,
        args: unknown,
        context?: QueryContext,
        ttlMs: number = this.DEFAULT_TTL_MS,
        secret: string = resolveSecret('CONFIRMATION_SECRET')
    ): string {
        secret = resolveSecret('CONFIRMATION_SECRET', secret);
        const now = Date.now();
        const payload: ConfirmationTicketPayload = {
            toolName,
            argsHash: this.hashArgs(args),
            tenantId: context?.tenantId,
            userId: context?.userId,
            nonce: crypto.randomUUID(),
            expiresAt: now + ttlMs
        };

        const serialized = Buffer.from(JSON.stringify(payload)).toString('base64url');
        const signature = crypto
            .createHmac('sha256', secret)
            .update(serialized)
            .digest('base64url');

        return `${serialized}.${signature}`;
    }

    /**
     * Validates that the provided confirmation ticket:
     * 1. Possesses a valid HMAC signature.
     * 2. Has not expired.
     * 3. Has not been replayed (single-use enforcement).
     * 4. Matches the exact tool name and SHA-256 hash of the submitted arguments.
     * 5. Matches the caller tenantId/userId if specified.
     */
    public static async verifyTicket(
        ticket: string,
        toolName: string,
        args: unknown,
        context?: QueryContext,
        secret: string = resolveSecret('CONFIRMATION_SECRET'),
        nonceStore: ConfirmationNonceStore = this.memoryStore
    ): Promise<{ valid: boolean; error?: string }> {
        resolveSecret('CONFIRMATION_SECRET', secret);
        if (process.env.NODE_ENV === 'production' && !nonceStore.distributed) {
            return { valid: false, error: 'Production confirmation requires a distributed nonce store.' };
        }

        if (!ticket || typeof ticket !== 'string') {
            return { valid: false, error: 'Confirmation ticket is missing or invalid format.' };
        }

        const parts = ticket.split('.');
        if (parts.length !== 2) {
            return { valid: false, error: 'Malformed confirmation ticket structure.' };
        }

        const [serialized, signature] = parts;
        const expectedSig = crypto
            .createHmac('sha256', secret)
            .update(serialized as string)
            .digest('base64url');

        const sigBuf = Buffer.from(signature as string);
        const expectedBuf = Buffer.from(expectedSig);

        if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
            return { valid: false, error: 'Invalid ticket signature: Cryptographic signature mismatch. Ticket has been tampered with.' };
        }

        let payload: ConfirmationTicketPayload;
        try {
            payload = ticketPayloadSchema.parse(JSON.parse(Buffer.from(serialized as string, 'base64url').toString('utf-8')));
        } catch {
            return { valid: false, error: 'Failed to parse confirmation ticket payload.' };
        }

        // Expiry check
        if (!payload || typeof payload.nonce !== 'string' || !payload.nonce || !Number.isFinite(payload.expiresAt) || Date.now() >= payload.expiresAt) {
            return { valid: false, error: `Ticket has expired: Confirmation ticket expired at ${payload?.expiresAt}.` };
        }

        // Tool name match check
        if (payload.toolName !== toolName) {
            return {
                valid: false,
                error: `Ticket tool mismatch: Ticket was issued for tool '${payload.toolName}' but invoked for '${toolName}'.`
            };
        }

        // Argument hash match check (detects parameter tampering)
        const currentHash = this.hashArgs(args);
        if (payload.argsHash !== currentHash) {
            return {
                valid: false,
                error: 'Ticket argument mismatch: Arguments do not match the parameters confirmed by the user. Parameter tampering detected.'
            };
        }

        // Tenant match check
        if (payload.tenantId !== context?.tenantId) {
            return { valid: false, error: 'Ticket tenant mismatch: Cross-tenant confirmation ticket use is prohibited.' };
        }

        if (payload.userId !== context?.userId) {
            return { valid: false, error: 'Ticket user mismatch.' };
        }
        try {
            if (!await nonceStore.consume(payload.nonce, payload.expiresAt)) {
                return { valid: false, error: 'Ticket nonce has already been consumed or expired.' };
            }
        } catch {
            return { valid: false, error: 'Confirmation nonce store unavailable.' };
        }
        return { valid: true };
    }
}
