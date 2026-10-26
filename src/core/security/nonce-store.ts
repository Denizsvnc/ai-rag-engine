/** Implementations must atomically reserve a nonce until expiry, with no fallback on errors. */
export interface ConfirmationNonceStore {
    readonly distributed: boolean;
    consume(nonce: string, expiresAt: number): Promise<boolean>;
}

export class MemoryConfirmationNonceStore implements ConfirmationNonceStore {
    readonly distributed = false;
    private used = new Map<string, number>();

    async consume(nonce: string, expiresAt: number): Promise<boolean> {
        const now = Date.now();
        for (const [key, expiry] of this.used) {
            if (expiry <= now) this.used.delete(key);
        }
        if (expiresAt <= now || this.used.has(nonce)) return false;
        this.used.set(nonce, expiresAt);
        return true;
    }
}

export interface ConfirmationRedisClient {
    set(key: string, value: string, px: 'PX', ttl: number, nx: 'NX'): Promise<unknown>;
}

/** All instances must use the same Redis database and prefix; nonce keys must not be evicted. */
export class RedisConfirmationNonceStore implements ConfirmationNonceStore {
    readonly distributed = true;
    constructor(private client: ConfirmationRedisClient, private prefix = 'rag:confirmation:') {}

    async consume(nonce: string, expiresAt: number): Promise<boolean> {
        const ttl = expiresAt - Date.now();
        if (ttl <= 0) return false;
        return await this.client.set(`${this.prefix}${nonce}`, '1', 'PX', ttl, 'NX') === 'OK';
    }
}
