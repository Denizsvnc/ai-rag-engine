import {
    type StorageCapabilities,
    type IStorageCapabilities,
    UnsupportedStorageCapabilityError
} from '../../interfaces/storage.interface.js';

export interface ProviderRegistration {
    role: 'vectors' | 'documents' | 'graph' | 'cache' | 'ingestion' | 'blob' | string;
    name: string;
    instance: unknown;
    capabilities: StorageCapabilities;
    healthy?: boolean;
}

/**
 * Central registry for inspecting, discovering, and negotiating storage provider capabilities.
 *
 * @remarks
 * Used by `RAGEngine` and `AdaptiveQueryPlanner` to verify that execution plans
 * strictly use database capabilities supported by the active infrastructure.
 *
 * @example
 * ```typescript
 * const registry = new StorageCapabilityRegistry();
 * registry.register('vectors', 'PostgresVectorAdapter', pgAdapter, {
 *   denseVectorSearch: true,
 *   atomicDocumentReplacement: true,
 *   metadataFiltering: true
 * });
 *
 * if (registry.hasCapability('vectors', 'atomicDocumentReplacement')) {
 *   // Safe to use transactional replacement
 * }
 * ```
 */
export class StorageCapabilityRegistry {
    private readonly providers = new Map<string, ProviderRegistration>();

    /**
     * Registers a storage provider instance with its capabilities.
     *
     * @param role - Functional storage role (e.g. 'vectors', 'documents', 'graph', 'ingestion').
     * @param name - Informative provider name (e.g. 'PostgresVectorAdapter', 'QdrantVectorAdapter').
     * @param instance - Live adapter instance.
     * @param capabilities - Optional capability override. Defaults to instance.capabilities if present.
     */
    public register(
        role: string,
        name: string,
        instance: unknown,
        capabilities?: StorageCapabilities
    ): void {
        const declaredCapabilities: StorageCapabilities = capabilities ?? (
            instance && typeof instance === 'object' && 'capabilities' in instance
                ? (instance as IStorageCapabilities).capabilities
                : {}
        );

        this.providers.set(role, {
            role,
            name,
            instance,
            capabilities: declaredCapabilities,
            healthy: true
        });
    }

    /**
     * Retrieves the registration record for a specific role.
     */
    public get(role: string): ProviderRegistration | undefined {
        return this.providers.get(role);
    }

    /**
     * Retrieves capabilities for a given storage role.
     */
    public getCapabilities(role: string): StorageCapabilities {
        const reg = this.providers.get(role);
        return reg ? reg.capabilities : {};
    }

    /**
     * Verifies if a provider assigned to a role supports a specific capability.
     */
    public hasCapability(role: string, capability: keyof StorageCapabilities): boolean {
        const caps = this.getCapabilities(role);
        return Boolean(caps[capability]);
    }

    /**
     * Asserts that a provider assigned to a role supports a required capability.
     * Throws `UnsupportedStorageCapabilityError` if unsupported or unconfigured.
     */
    public assertCapability(role: string, capability: keyof StorageCapabilities, reason?: string): void {
        const reg = this.providers.get(role);
        if (!reg) {
            throw new UnsupportedStorageCapabilityError(role, capability, `No provider registered for role "${role}".`);
        }
        if (!reg.capabilities[capability]) {
            throw new UnsupportedStorageCapabilityError(reg.name, capability, reason);
        }
    }

    /**
     * Determines optimal retrieval strategy supported by the active vector store.
     *
     * @returns 'native_hybrid' | 'engine_hybrid' | 'dense' | 'sparse' | 'none'
     */
    public getOptimalRetrievalStrategy(): 'native_hybrid' | 'engine_hybrid' | 'dense' | 'sparse' | 'none' {
        const caps = this.getCapabilities('vectors');
        if (caps.nativeHybridSearch) return 'native_hybrid';
        if (caps.denseVectorSearch && caps.sparseRetrieval) return 'engine_hybrid';
        if (caps.denseVectorSearch) return 'dense';
        if (caps.sparseRetrieval) return 'sparse';
        return 'none';
    }

    /**
     * Verifies whether graph traversal and GraphRAG operations are fully supported.
     */
    public canExecuteGraphRAG(): boolean {
        const graphCaps = this.getCapabilities('graph');
        const vectorCaps = this.getCapabilities('vectors');
        return Boolean(graphCaps.graphTraversal && vectorCaps.denseVectorSearch);
    }

    /**
     * Verifies whether atomic document replacement without orphaned chunks is supported.
     */
    public canExecuteAtomicReplacement(): boolean {
        const caps = this.getCapabilities('vectors');
        return Boolean(caps.atomicDocumentReplacement);
    }

    /**
     * Returns a snapshot of all registered providers and their capabilities.
     */
    public getMatrix(): Record<string, { provider: string; capabilities: StorageCapabilities }> {
        const matrix: Record<string, { provider: string; capabilities: StorageCapabilities }> = {};
        for (const [role, reg] of this.providers.entries()) {
            matrix[role] = {
                provider: reg.name,
                capabilities: { ...reg.capabilities }
            };
        }
        return matrix;
    }
}

