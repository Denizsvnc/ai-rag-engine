import crypto from 'crypto';
import type { QueryContext } from '../../interfaces/query-context.interface';

export interface ConfirmationTicketPayload {
    toolName: string;
    argsHash: string;
    tenantId?: string | undefined;
    userId?: string | undefined;
    nonce: string;
    expiresAt: number;
}

export interface TicketTargetOptions {
    toolName: string;
    args: any;
    tenantId?: string | undefined;
    userId?: string | undefined;
}

export class ConfirmationService {
    private static usedNonces: Map<string, number> = new Map();
    private static readonly DEFAULT_SECRET = process.env.CONFIRMATION_SECRET || 'rag-engine-mutation-ticket-secret';
    private static readonly DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

    constructor(
        private secret: string = ConfirmationService.DEFAULT_SECRET,
        private ttlMs: number = ConfirmationService.DEFAULT_TTL_MS
    ) {}

    /**
     * Instance method to issue a ticket using the configured secret and TTL.
     */
    public issueTicket(options: TicketTargetOptions): string;
    public issueTicket(toolName: string, args: any, context?: QueryContext): string;
    public issueTicket(optionsOrName: TicketTargetOptions | string, maybeArgs?: any, maybeContext?: QueryContext): string {
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
    public verifyTicket(ticket: string, options: TicketTargetOptions): { valid: boolean; payload?: ConfirmationTicketPayload };
    public verifyTicket(ticket: string, toolName: string, args: any, context?: QueryContext): { valid: boolean; payload?: ConfirmationTicketPayload };
    public verifyTicket(
        ticket: string,
        optionsOrName: TicketTargetOptions | string,
        maybeArgs?: any,
        maybeContext?: QueryContext
    ): { valid: boolean; payload?: ConfirmationTicketPayload } {
        let toolName: string;
        let args: any;
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

        const result = ConfirmationService.verifyTicket(ticket, toolName, args, context, this.secret);
        if (!result.valid) {
            throw new Error(result.error || 'Ticket verification failed.');
        }
        return { valid: true };
    }

    /**
     * Produces a deterministic canonical JSON string for arguments regardless of key order.
     */
    public static canonicalize(data: any): string {
        if (data === null || typeof data !== 'object') {
            return JSON.stringify(data);
        }
        if (Array.isArray(data)) {
            return '[' + data.map(v => this.canonicalize(v)).join(',') + ']';
        }
        const sortedKeys = Object.keys(data).sort();
        const parts = sortedKeys.map(k => `${JSON.stringify(k)}:${this.canonicalize(data[k])}`);
        return '{' + parts.join(',') + '}';
    }

    /**
     * Computes SHA-256 hash of canonicalized tool arguments.
     */
    public static hashArgs(args: any): string {
        const canonical = this.canonicalize(args || {});
        return crypto.createHash('sha256').update(canonical).digest('hex');
    }

    /**
     * Issues a cryptographically signed, short-lived, single-use ticket for a proposed mutating tool invocation.
     */
    public static issueTicket(
        toolName: string,
        args: any,
        context?: QueryContext,
        ttlMs: number = this.DEFAULT_TTL_MS,
        secret: string = this.DEFAULT_SECRET
    ): string {
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
    public static verifyTicket(
        ticket: string,
        toolName: string,
        args: any,
        context?: QueryContext,
        secret: string = this.DEFAULT_SECRET
    ): { valid: boolean; error?: string } {
        this.cleanupExpiredNonces();

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
            payload = JSON.parse(Buffer.from(serialized as string, 'base64url').toString('utf-8'));
        } catch {
            return { valid: false, error: 'Failed to parse confirmation ticket payload.' };
        }

        // Expiry check
        if (Date.now() > payload.expiresAt) {
            return { valid: false, error: `Ticket has expired: Confirmation ticket expired at ${new Date(payload.expiresAt).toISOString()}.` };
        }

        // Anti-replay single-use check
        if (this.usedNonces.has(payload.nonce)) {
            return { valid: false, error: 'Ticket nonce has already been consumed: Confirmation ticket has already been used (anti-replay violation).' };
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
        if (payload.tenantId && context?.tenantId && payload.tenantId !== context.tenantId) {
            return { valid: false, error: 'Ticket tenant mismatch: Cross-tenant confirmation ticket use is prohibited.' };
        }

        // Mark nonce as spent
        this.usedNonces.set(payload.nonce, payload.expiresAt);
        return { valid: true };
    }

    private static cleanupExpiredNonces(): void {
        const now = Date.now();
        for (const [nonce, expiresAt] of this.usedNonces.entries()) {
            if (now > expiresAt) {
                this.usedNonces.delete(nonce);
            }
        }
    }
}
