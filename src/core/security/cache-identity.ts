import crypto from 'node:crypto';
import { resolveSecret } from './secrets.js';

/**
 * Multi-dimensional parameters determining unique cryptographic cache identity.
 */
export interface CacheKeyDimensions {
    /** Tenant / organization identifier for strict multi-tenant boundary. */
    tenantId: string;
    /** Raw user query. Will be normalized before hashing. */
    query: string;
    /** Caller RBAC roles. Sorted canonically to ensure role order invariance. */
    roles?: string[] | undefined;
    /** Specific caller user identifier if user-level caching is desired. */
    userId?: string | undefined;
    /** Monotonically increasing source document store revision head. */
    documentRevision?: string | number | undefined;
    /** Knowledge graph store revision head. */
    graphRevision?: string | number | undefined;
    /** Tenant security or authorization policy version. */
    policyVersion?: string | number | undefined;
    /** Active LLM model identifier (e.g. 'gemini-2.0-flash', 'gpt-4o'). */
    modelId?: string | undefined;
    /** Active embedding model identifier (e.g. 'all-MiniLM-L6-v2'). */
    embeddingModelId?: string | undefined;
    /** Strategy configuration or engine configuration revision. */
    strategyConfigVersion?: string | number | undefined;
    /** Cache scope namespace. */
    cacheScope?: 'response' | 'semantic' | 'prefix' | 'cag' | undefined;
    /** Arbitrary execution metadata containing revision hints. */
    metadata?: Record<string, unknown> | undefined;
}

/**
 * Centralized cryptographic cache identity service.
 *
 * @remarks
 * Eliminates cache scope leakage across roles, users, and document revisions.
 * Replaces insecure polynomial hashes with collision-resistant HMAC-SHA256 digests.
 * Prevents raw query or PII exposure in Redis / Memory cache keys.
 */
export class CacheIdentity {
    public static readonly SCHEMA_VERSION = 'v4';

    /**
     * Builds a secure, multi-dimensional, collision-resistant cache key.
     *
     * @param dimensions - Multi-dimensional context factors.
     * @param secret - Optional secret for HMAC signing. Defaults to `resolveSecret('CACHE_SECRET')` or `JWT_SECRET`.
     * @returns Fully qualified scoped cache key (e.g. `rag:v4:tenant_1:cag:8f4c...`).
     */
    public static buildCacheKey(dimensions: CacheKeyDimensions, secret?: string): string {
        const { tenantId, query, cacheScope = 'cag' } = dimensions;

        if (!tenantId || typeof tenantId !== 'string' || tenantId.trim().length === 0) {
            throw new Error('[CacheIdentity] tenantId is required to construct a multi-tenant cache key.');
        }

        // 1. Normalize query (Unicode NFC normalization, trim, normalize internal whitespace)
        const normalizedQuery = (query || '')
            .normalize('NFC')
            .trim()
            .replace(/\s+/g, ' ')
            .toLowerCase();

        // 2. Canonicalize roles (sorted, deduplicated, lowercased)
        const canonicalRoles = Array.isArray(dimensions.roles)
            ? Array.from(new Set(dimensions.roles.map(r => r.trim().toLowerCase()))).sort()
            : [];

        // 3. Resolve revision dimensions (from flat properties or nested metadata)
        const docRev = dimensions.documentRevision ?? (dimensions.metadata?.['documentRevision'] as string | number | undefined);
        const graphRev = dimensions.graphRevision ?? (dimensions.metadata?.['graphRevision'] as string | number | undefined);
        const policyVer = dimensions.policyVersion ?? (dimensions.metadata?.['policyVersion'] as string | number | undefined);
        const modelId = dimensions.modelId ?? (dimensions.metadata?.['modelId'] as string | undefined);
        const embModelId = dimensions.embeddingModelId ?? (dimensions.metadata?.['embeddingModelId'] as string | undefined);
        const stratVer = dimensions.strategyConfigVersion ?? (dimensions.metadata?.['strategyConfigVersion'] as string | number | undefined);

        // 4. Construct deterministic canonical payload
        const canonicalPayload = JSON.stringify({
            schemaVersion: CacheIdentity.SCHEMA_VERSION,
            tenantId: tenantId.trim(),
            query: normalizedQuery,
            roles: canonicalRoles,
            userId: dimensions.userId ? dimensions.userId.trim() : null,
            docRev: docRev !== undefined ? String(docRev) : '0',
            graphRev: graphRev !== undefined ? String(graphRev) : '0',
            policyVer: policyVer !== undefined ? String(policyVer) : '1',
            modelId: modelId || 'default_llm',
            embModelId: embModelId || 'default_emb',
            stratVer: stratVer !== undefined ? String(stratVer) : '1',
            scope: cacheScope
        });

        // 4. Compute cryptographic HMAC-SHA256 (or SHA256 if no secret provided)
        const signingSecret = secret || resolveSecret('CACHE_SECRET', process.env.CACHE_SECRET || process.env.JWT_SECRET || 'rag-engine-cache-key-secret-seed-32b');
        const hmac = crypto.createHmac('sha256', signingSecret);
        hmac.update(canonicalPayload);
        const digest = hmac.digest('hex');

        // 5. Structure namespaced key: prefix:schema:tenantId:scope:digest
        return `rag:${CacheIdentity.SCHEMA_VERSION}:${tenantId.trim()}:${cacheScope}:${digest}`;
    }
}
