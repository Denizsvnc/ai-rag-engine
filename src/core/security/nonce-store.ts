/**
 * Storage contract for cryptographic confirmation nonces to prevent replay attacks.
 *
 * @remarks
 * Implementations must atomically reserve a nonce until expiry, with no fallback on errors.
 */
export interface ConfirmationNonceStore {
    /** Whether the store is shared across multiple distributed instances. */
    readonly distributed: boolean;
    /**
     * Atomically consumes a nonce if not previously seen and not expired.
     *
     * @param nonce - Unique nonce string.
     * @param expiresAt - Unix timestamp (ms) when the nonce expires.
     * @returns Promise resolving to true if nonce was fresh and successfully claimed.
     */
    consume(nonce: string, expiresAt: number): Promise<boolean>;
}

/**
 * In-memory non-distributed implementation of {@link ConfirmationNonceStore}.
 *
 * @remarks
 * Suitable for single-instance deployments, development, and unit testing.
 *
 * @example
 * ```typescript
 * import { MemoryConfirmationNonceStore } from '@denizsvnc/ai-rag-engine';
 *
 * const nonceStore = new MemoryConfirmationNonceStore();
 * const consumed = await nonceStore.consume('unique_nonce_123', Date.now() + 60000);
 * ```
 */
export class MemoryConfirmationNonceStore implements ConfirmationNonceStore {
    public readonly distributed = false;
    private used = new Map<string, number>();

    /**
     * Consumes a nonce in memory.
     *
     * @param nonce - Nonce identifier.
     * @param expiresAt - Expiry timestamp in milliseconds.
     * @returns True if fresh and consumed.
     */
    public async consume(nonce: string, expiresAt: number): Promise<boolean> {
        const now = Date.now();
        for (const [key, expiry] of this.used) {
            if (expiry <= now) this.used.delete(key);
        }
        if (expiresAt <= now || this.used.has(nonce)) return false;
        this.used.set(nonce, expiresAt);
        return true;
    }
}

/**
 * Minimal Redis client interface required for atomic distributed nonce reservations.
 */
export interface ConfirmationRedisClient {
    /** Executes Redis SET with PX and NX options atomically. */
    set(key: string, value: string, px: 'PX', ttl: number, nx: 'NX'): Promise<unknown>;
}

/**
 * Distributed Redis-backed implementation of {@link ConfirmationNonceStore}.
 *
 * @remarks
 * Uses atomic `SET key val PX ttl NX` to prevent replay attacks across horizontal cluster pods.
 *
 * @example
 * ```typescript
 * import { RedisConfirmationNonceStore } from '@denizsvnc/ai-rag-engine';
 *
 * const nonceStore = new RedisConfirmationNonceStore(redisClient);
 * const valid = await nonceStore.consume(ticket.nonce, ticket.expiresAt);
 * ```
 */
export class RedisConfirmationNonceStore implements ConfirmationNonceStore {
    public readonly distributed = true;

    /**
     * Initializes RedisConfirmationNonceStore.
     *
     * @param client - Redis client instance with atomic SET support.
     * @param prefix - Key prefix for nonce entries in Redis. @defaultValue 'rag:confirmation:'
     */
    constructor(private client: ConfirmationRedisClient, private prefix = 'rag:confirmation:') {}

    /**
     * Atomically claims a nonce in Redis with TTL.
     *
     * @param nonce - Nonce identifier.
     * @param expiresAt - Expiry timestamp in milliseconds.
     * @returns True if successfully claimed in Redis.
     */
    public async consume(nonce: string, expiresAt: number): Promise<boolean> {
        const ttl = expiresAt - Date.now();
        if (ttl <= 0) return false;
        return await this.client.set(`${this.prefix}${nonce}`, '1', 'PX', ttl, 'NX') === 'OK';
    }
}
