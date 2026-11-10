import { createHash } from 'node:crypto';
import type { IIngestionStore, StoredUpload, StorageCapabilities } from '../../interfaces/storage.interface.js';
import type { IngestionSettings } from '../../interfaces/ingestion.interface.js';
import type { JobStatus } from '../queue/job-queue.interface.js';
import { IngestionQuotaError, IngestionConflictError } from './postgres-ingestion-store.js';

/**
 * In-memory implementation of `IIngestionStore` for local development, edge runtimes, and fast unit tests.
 *
 * @remarks
 * Enforces multi-tenant isolation, version tracking, idempotency deduplication, and byte quotas in memory
 * without requiring a running PostgreSQL instance.
 *
 * @example
 * ```typescript
 * import { MemoryIngestionStore, QueuedIngestionService, InMemoryJobQueue } from '@denizsvnc/ai-rag-engine';
 *
 * const store = new MemoryIngestionStore();
 * const queue = new InMemoryJobQueue();
 * const service = new QueuedIngestionService(store, queue);
 * ```
 */
export class MemoryIngestionStore implements IIngestionStore {
    public readonly capabilities: StorageCapabilities = {
        transactions: false,
        namespaceIsolation: true,
        versioning: true,
        blobStorage: true,
        atomicDocumentReplacement: true
    };

    private readonly uploads = new Map<string, StoredUpload>();
    private readonly heads = new Map<string, number>(); // key: `${tenantId}:${documentId}` -> version

    public hasCapability(capability: keyof StorageCapabilities): boolean {
        return Boolean(this.capabilities[capability]);
    }

    public async ready(): Promise<void> {
        // In-memory store is always ready
    }

    public async put(
        input: {
            tenantId: string;
            userId: string;
            documentId: string;
            filename: string;
            content: Buffer;
            settings: IngestionSettings;
            idempotencyKey?: string | undefined;
        },
        limits: { maxPending: number; maxStoredBytes: number }
    ): Promise<StoredUpload> {
        const digest = createHash('sha256').update(input.content).digest('hex');
        const headKey = `${input.tenantId}:${input.documentId}`;

        // 1. Idempotency Check
        if (input.idempotencyKey) {
            for (const upload of this.uploads.values()) {
                if (upload.tenantId === input.tenantId && (upload as any).idempotencyKey === input.idempotencyKey) {
                    if (upload.digest === digest && upload.filename === input.filename) {
                        return upload;
                    }
                    throw new IngestionConflictError('Idempotency key already used for different content.');
                }
            }
        }

        // Check if identical active version already exists
        const currentVersion = this.heads.get(headKey);
        if (currentVersion !== undefined) {
            for (const upload of this.uploads.values()) {
                if (
                    upload.tenantId === input.tenantId &&
                    upload.documentId === input.documentId &&
                    upload.version === currentVersion &&
                    upload.digest === digest &&
                    upload.filename === input.filename &&
                    upload.settings.chunkSize === input.settings.chunkSize &&
                    upload.settings.chunkOverlap === input.settings.chunkOverlap
                ) {
                    return upload;
                }
            }
        }

        // 2. Quota Verification
        let pendingCount = 0;
        let storedBytes = 0;
        for (const upload of this.uploads.values()) {
            if (upload.tenantId === input.tenantId) {
                if (upload.status === 'pending' || upload.status === 'queued' || upload.status === 'processing') {
                    pendingCount++;
                }
                if (upload.content) {
                    storedBytes += upload.content.length;
                }
            }
        }

        if (pendingCount >= limits.maxPending || storedBytes + input.content.length > limits.maxStoredBytes) {
            throw new IngestionQuotaError('Tenant ingestion quota exceeded.');
        }

        // 3. Increment Version
        const nextVersion = (currentVersion ?? 0) + 1;
        this.heads.set(headKey, nextVersion);

        const id = createHash('sha256')
            .update(JSON.stringify([input.tenantId, input.documentId, nextVersion, digest]))
            .digest('hex');

        const now = Date.now();
        const stored: StoredUpload & { idempotencyKey?: string } = {
            id,
            tenantId: input.tenantId,
            userId: input.userId,
            documentId: input.documentId,
            filename: input.filename,
            version: nextVersion,
            digest,
            settings: input.settings,
            content: Buffer.from(input.content),
            status: 'pending',
            result: null,
            error: null,
            createdAt: now,
            updatedAt: now,
            ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {})
        };

        this.uploads.set(id, stored);
        return stored;
    }

    public async get(id: string, tenantId?: string): Promise<StoredUpload | null> {
        if (!tenantId) return null;
        const upload = this.uploads.get(id);
        if (!upload || upload.tenantId !== tenantId) return null;
        return upload;
    }

    public async dispatchable(limit = 100): Promise<Array<{ id: string; tenantId: string }>> {
        const list: Array<{ id: string; tenantId: string }> = [];
        for (const upload of this.uploads.values()) {
            if (upload.status === 'pending' || upload.status === 'queued' || upload.status === 'processing') {
                list.push({ id: upload.id, tenantId: upload.tenantId });
                if (list.length >= limit) break;
            }
        }
        return list;
    }

    public async mark(id: string, status: 'queued' | 'processing' | 'failed', error?: string): Promise<void> {
        const upload = this.uploads.get(id);
        if (!upload) return;
        if (status === 'queued' && upload.status !== 'pending') return;
        if (upload.status === 'completed' || upload.status === 'failed') return;

        upload.status = status;
        upload.error = error ?? null;
        upload.updatedAt = Date.now();
    }

    public async complete(id: string, result: Record<string, unknown>): Promise<void> {
        const upload = this.uploads.get(id);
        if (!upload) return;

        upload.status = 'completed';
        upload.result = result;
        upload.error = null;
        upload.content = null; // Release memory for raw blob
        upload.updatedAt = Date.now();
    }

    public async resetFailed(id: string, tenantId: string): Promise<void> {
        const upload = this.uploads.get(id);
        if (!upload || upload.tenantId !== tenantId || upload.status !== 'failed' || !upload.content) {
            throw new Error('Failed job missing or its retry payload has expired.');
        }

        upload.status = 'pending';
        upload.error = null;
        upload.updatedAt = Date.now();
    }

    public async expireFailedBlobs(retentionDays = 7): Promise<void> {
        const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
        for (const upload of this.uploads.values()) {
            if (upload.status === 'failed' && upload.content && upload.updatedAt < cutoff) {
                upload.content = null;
            }
        }
    }

    /** Clears all in-memory records (useful in test teardown). */
    public clear(): void {
        this.uploads.clear();
        this.heads.clear();
    }
}
