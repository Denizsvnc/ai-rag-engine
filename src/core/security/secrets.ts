import { randomBytes } from 'node:crypto';

const developmentSecrets = new Map<string, string>();
const knownDefaults = new Set(['dev-secret-key-change-in-production', 'rag-engine-mutation-ticket-secret']);

/** Development keys are unpredictable and process-local. Production never falls back. */
export function resolveSecret(name: string, supplied?: string): string {
    const value = supplied ?? process.env[name];
    if (value && !knownDefaults.has(value) && (process.env.NODE_ENV !== 'production' || Buffer.byteLength(value) >= 32)) {
        return value;
    }
    if (process.env.NODE_ENV === 'production' || value) {
        throw new Error(`${name} must be a non-default secret (at least 32 bytes in production).`);
    }
    let secret = developmentSecrets.get(name);
    if (!secret) {
        secret = randomBytes(32).toString('hex');
        developmentSecrets.set(name, secret);
    }
    return secret;
}
