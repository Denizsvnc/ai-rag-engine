import fs from 'node:fs';
import path from 'node:path';
import type { IBlobStore, StorageCapabilities } from '../../interfaces/storage.interface.js';

export interface LocalFsBlobOptions {
    /** Root directory path for storing uploads. @defaultValue './data/blobs' */
    baseDir?: string | undefined;
}

/**
 * Local filesystem blob storage adapter for storing large document binaries on local disk.
 *
 * @remarks
 * Directory path traversal (`..` and absolute paths) is strictly blocked.
 * Stores blobs partitioned by tenant sub-folders: `${baseDir}/${tenantId}/${sanitizedKey}`.
 *
 * @example
 * ```typescript
 * import { LocalFsBlobStore } from '@denizsvnc/ai-rag-engine';
 *
 * const blobStore = new LocalFsBlobStore({ baseDir: './uploads' });
 * await blobStore.put('contracts/spec.pdf', pdfBuffer, 'tenant_1');
 * ```
 */
export class LocalFsBlobStore implements IBlobStore {
    public readonly capabilities: StorageCapabilities = {
        blobStorage: true,
        namespaceIsolation: true,
        batchOperations: false
    };

    private readonly baseDir: string;

    constructor(options: LocalFsBlobOptions = {}) {
        this.baseDir = path.resolve(process.cwd(), options.baseDir ?? './data/blobs');
    }

    public hasCapability(capability: keyof StorageCapabilities): boolean {
        return Boolean(this.capabilities[capability]);
    }

    private resolvePath(key: string, tenantId: string): string {
        const cleanTenant = tenantId.replace(/[^a-zA-Z0-9_-]/g, '_');
        if (key.includes('..') || path.isAbsolute(key)) {
            throw new Error(`[LocalFsBlobStore] Path traversal detected: ${key}`);
        }
        const targetPath = path.resolve(this.baseDir, cleanTenant, key);

        const tenantRoot = path.resolve(this.baseDir, cleanTenant);
        if (!targetPath.startsWith(tenantRoot)) {
            throw new Error(`[LocalFsBlobStore] Path traversal detected: ${key}`);
        }
        return targetPath;
    }

    public async put(key: string, data: Buffer, tenantId: string): Promise<{ uri: string; sizeBytes: number }> {
        const filePath = this.resolvePath(key, tenantId);
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, data);
        return {
            uri: `file://${filePath}`,
            sizeBytes: data.length
        };
    }

    public async get(key: string, tenantId: string): Promise<Buffer | null> {
        const filePath = this.resolvePath(key, tenantId);
        try {
            return await fs.promises.readFile(filePath);
        } catch (e: unknown) {
            if ((e as { code?: string }).code === 'ENOENT') return null;
            throw e;
        }
    }

    public async delete(key: string, tenantId: string): Promise<boolean> {
        const filePath = this.resolvePath(key, tenantId);
        try {
            await fs.promises.unlink(filePath);
            return true;
        } catch (e: unknown) {
            if ((e as { code?: string }).code === 'ENOENT') return false;
            throw e;
        }
    }

    public async exists(key: string, tenantId: string): Promise<boolean> {
        const filePath = this.resolvePath(key, tenantId);
        try {
            await fs.promises.access(filePath);
            return true;
        } catch {
            return false;
        }
    }
}
