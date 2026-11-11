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
 * Security Hardening:
 * - Strict tenantId validation matching `/^[a-zA-Z0-9_-]+$/`.
 * - Multi-layer path traversal prevention (`..`, absolute paths, null bytes, backslashes).
 * - Exact directory boundary confinement (`tenantRoot + path.sep`).
 * - Active symlink traversal detection across directory tree and file targets (`lstat`, `realpath`).
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

    private resolvePath(key: string, tenantId: string): { targetPath: string; tenantRoot: string } {
        if (!tenantId || typeof tenantId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(tenantId)) {
            throw new Error(`[LocalFsBlobStore] Invalid tenantId: "${tenantId}". Must match /^[a-zA-Z0-9_-]+$/`);
        }

        if (!key || typeof key !== 'string' || key.trim().length === 0) {
            throw new Error('[LocalFsBlobStore] Blob key must be a non-empty string.');
        }

        if (key.includes('\0') || key.includes('..') || path.isAbsolute(key) || key.includes('\\')) {
            throw new Error(`[LocalFsBlobStore] Path traversal detected: "${key}"`);
        }

        const tenantRoot = path.resolve(this.baseDir, tenantId);
        const targetPath = path.resolve(tenantRoot, key);

        // Enforce boundary with trailing separator to prevent prefix collision (e.g. tenant-a vs tenant-alpha)
        if (targetPath !== tenantRoot && !targetPath.startsWith(tenantRoot + path.sep)) {
            throw new Error(`[LocalFsBlobStore] Path traversal detected: key escapes tenant boundary: "${key}"`);
        }

        return { targetPath, tenantRoot };
    }

    private async verifyNoSymlinks(targetPath: string, tenantRoot: string): Promise<void> {
        let curr = path.dirname(targetPath);
        while (curr.startsWith(tenantRoot)) {
            try {
                const stat = await fs.promises.lstat(curr);
                if (stat.isSymbolicLink()) {
                    throw new Error(`[LocalFsBlobStore] Symlink traversal detected in directory path: "${curr}"`);
                }
            } catch (err: unknown) {
                if ((err as { code?: string }).code === 'ENOENT') {
                    curr = path.dirname(curr);
                    continue;
                }
                throw err;
            }
            if (curr === tenantRoot) break;
            curr = path.dirname(curr);
        }

        try {
            const stat = await fs.promises.lstat(targetPath);
            if (stat.isSymbolicLink()) {
                throw new Error(`[LocalFsBlobStore] Target file is a forbidden symlink: "${targetPath}"`);
            }
        } catch (err: unknown) {
            if ((err as { code?: string }).code !== 'ENOENT') {
                throw err;
            }
        }
    }

    public async put(key: string, data: Buffer, tenantId: string): Promise<{ uri: string; sizeBytes: number }> {
        const { targetPath, tenantRoot } = this.resolvePath(key, tenantId);

        await this.verifyNoSymlinks(targetPath, tenantRoot);

        await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.promises.writeFile(targetPath, data);

        return {
            uri: `file://${targetPath}`,
            sizeBytes: data.length
        };
    }

    public async get(key: string, tenantId: string): Promise<Buffer | null> {
        const { targetPath, tenantRoot } = this.resolvePath(key, tenantId);
        try {
            await this.verifyNoSymlinks(targetPath, tenantRoot);
            return await fs.promises.readFile(targetPath);
        } catch (e: unknown) {
            if ((e as { code?: string }).code === 'ENOENT') return null;
            throw e;
        }
    }

    public async delete(key: string, tenantId: string): Promise<boolean> {
        const { targetPath, tenantRoot } = this.resolvePath(key, tenantId);
        try {
            await this.verifyNoSymlinks(targetPath, tenantRoot);
            await fs.promises.unlink(targetPath);
            return true;
        } catch (e: unknown) {
            if ((e as { code?: string }).code === 'ENOENT') return false;
            throw e;
        }
    }

    public async exists(key: string, tenantId: string): Promise<boolean> {
        const { targetPath, tenantRoot } = this.resolvePath(key, tenantId);
        try {
            await this.verifyNoSymlinks(targetPath, tenantRoot);
            await fs.promises.access(targetPath);
            return true;
        } catch {
            return false;
        }
    }
}
