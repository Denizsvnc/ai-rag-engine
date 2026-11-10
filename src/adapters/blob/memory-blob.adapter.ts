import type { IBlobStore, StorageCapabilities } from '../../interfaces/storage.interface.js';

/**
 * In-memory blob/object storage adapter for testing and ephemeral environments.
 *
 * @remarks
 * Scopes all stored buffers by composite `${tenantId}::${key}` keys to guarantee multi-tenant isolation.
 *
 * @example
 * ```typescript
 * import { MemoryBlobStore } from '@denizsvnc/ai-rag-engine';
 *
 * const blobStore = new MemoryBlobStore();
 * await blobStore.put('contracts/nda.pdf', fileBuffer, 'tenant_1');
 * const exists = await blobStore.exists('contracts/nda.pdf', 'tenant_1');
 * ```
 */
export class MemoryBlobStore implements IBlobStore {
    public readonly capabilities: StorageCapabilities = {
        blobStorage: true,
        namespaceIsolation: true,
        batchOperations: true
    };

    private readonly storage = new Map<string, Buffer>();

    public hasCapability(capability: keyof StorageCapabilities): boolean {
        return Boolean(this.capabilities[capability]);
    }

    public async put(key: string, data: Buffer, tenantId: string): Promise<{ uri: string; sizeBytes: number }> {
        const composite = `${tenantId}::${key}`;
        this.storage.set(composite, Buffer.from(data));
        return {
            uri: `memory://${tenantId}/${key}`,
            sizeBytes: data.length
        };
    }

    public async get(key: string, tenantId: string): Promise<Buffer | null> {
        const composite = `${tenantId}::${key}`;
        const buf = this.storage.get(composite);
        return buf ? Buffer.from(buf) : null;
    }

    public async delete(key: string, tenantId: string): Promise<boolean> {
        const composite = `${tenantId}::${key}`;
        return this.storage.delete(composite);
    }

    public async exists(key: string, tenantId: string): Promise<boolean> {
        const composite = `${tenantId}::${key}`;
        return this.storage.has(composite);
    }

    public clear(): void {
        this.storage.clear();
    }
}

