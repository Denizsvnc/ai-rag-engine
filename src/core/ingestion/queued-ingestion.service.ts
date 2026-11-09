import type { DocumentUploadPayload } from '../../services/document-ingestion.service.js';
import { DocumentIngestionService } from '../../services/document-ingestion.service.js';
import type { IIngestionBackend, IngestionSettings } from '../../interfaces/ingestion.interface.js';
import type { Job, JobStatus } from '../queue/job-queue.interface.js';
import type { BullMQJobQueue } from '../queue/bullmq-queue.js';
import { PostgresIngestionStore, IngestionQuotaError } from './postgres-ingestion-store.js';

export type IngestionQueue = Pick<BullMQJobQueue<IngestionReference>, 'add' | 'getJob' | 'ready' | 'process' | 'retry' | 'close'>;
export interface IngestionReference { id: string; tenantId: string }
export interface QueuedIngestionOptions {
    maxUploadBytes?: number | undefined;
    maxPendingPerTenant?: number | undefined;
    maxStoredBytesPerTenant?: number | undefined;
    chunkSize?: number | undefined;
    chunkOverlap?: number | undefined;
}

/** API-side producer. PostgreSQL commits the upload before Redis dispatch; a worker reconciles the outbox. */
export class QueuedIngestionService implements IIngestionBackend {
    private readonly settings: IngestionSettings;
    private readonly maxBytes: number;
    constructor(public readonly store: PostgresIngestionStore, public readonly queue: IngestionQueue, private readonly options: QueuedIngestionOptions = {}) {
        this.maxBytes = options.maxUploadBytes ?? 5 * 1024 * 1024;
        this.settings = { chunkSize: options.chunkSize ?? 500, chunkOverlap: options.chunkOverlap ?? 50 };
        if (!Number.isInteger(this.settings.chunkSize) || this.settings.chunkSize < 32 || this.settings.chunkSize > 10000
            || !Number.isInteger(this.settings.chunkOverlap) || this.settings.chunkOverlap < 0 || this.settings.chunkOverlap >= this.settings.chunkSize) {
            throw new Error('Invalid ingestion chunk size/overlap.');
        }
        for (const value of [this.maxBytes, options.maxPendingPerTenant ?? 100, options.maxStoredBytesPerTenant ?? 50 * 1024 * 1024]) {
            if (!Number.isSafeInteger(value) || value < 1) throw new Error('Ingestion limits must be positive integers.');
        }
    }

    public async submitDocument(payload: DocumentUploadPayload): Promise<{ jobId: string; status: JobStatus }> {
        const { tenantId, userId, filename } = payload;
        if (!tenantId?.trim() || !userId?.trim()) throw new Error('Trusted tenantId and userId are required.');
        if (typeof filename !== 'string' || !filename.trim() || filename.length > 255 || /[/\\\0]/.test(filename)) throw new Error('Invalid filename.');
        const documentId = payload.documentId ?? filename;
        if (typeof documentId !== 'string' || !documentId.trim() || documentId.length > 255) throw new Error('Invalid documentId.');
        if (payload.idempotencyKey !== undefined && (!payload.idempotencyKey.trim() || payload.idempotencyKey.length > 200)) throw new Error('Invalid idempotency key.');
        const content = await this.bytes(payload);
        const safety = DocumentIngestionService.validateFileSafety(filename, content);
        if (!safety.safe) throw new Error(`Document rejected: ${safety.reason}`);
        const saved = await this.store.put({ tenantId, userId, documentId, filename, content, settings: this.settings, idempotencyKey: payload.idempotencyKey }, {
            maxPending: this.options.maxPendingPerTenant ?? 100,
            maxStoredBytes: this.options.maxStoredBytesPerTenant ?? 50 * 1024 * 1024
        });
        if (saved.status === 'pending') {
            try { await this.dispatch({ id: saved.id, tenantId }); } catch { /* Durable outbox remains pending. */ }
        }
        return { jobId: saved.id, status: saved.status === 'pending' ? (await this.store.get(saved.id, tenantId))!.status : saved.status };
    }

    public async flushOutbox(): Promise<void> {
        for (const reference of await this.store.dispatchable()) await this.dispatch(reference);
    }

    private async dispatch(reference: IngestionReference): Promise<void> {
        const existing = await this.queue.getJob(reference.id);
        if (!existing) await this.queue.add('document-ingest', reference, reference.id);
        else if (existing.status === 'failed') { await this.store.mark(reference.id, 'failed', existing.error); return; }
        await this.store.mark(reference.id, 'queued');
    }

    public async getJobStatus(id: string, tenantId?: string): Promise<Job | null> {
        const saved = await this.store.get(id, tenantId);
        if (!saved) return null;
        let progress = saved.status === 'completed' ? 100 : 0;
        let attemptsMade: number | undefined;
        try {
            const job = await this.queue.getJob(id);
            progress = Math.max(progress, job?.progress ?? 0);
            attemptsMade = job?.attemptsMade;
        } catch { /* PostgreSQL status remains available during Redis outages. */ }
        return {
            id, type: 'document-ingest', data: { tenantId: saved.tenantId, userId: saved.userId, documentId: saved.documentId },
            status: saved.status, progress, attemptsMade,
            result: saved.result ?? undefined, error: saved.error ?? undefined,
            createdAt: saved.createdAt, updatedAt: saved.updatedAt,
            ...(saved.status === 'completed' || saved.status === 'failed' ? { completedAt: saved.updatedAt } : {})
        };
    }

    public async retryJob(id: string, tenantId: string): Promise<void> {
        const saved = await this.store.get(id, tenantId);
        if (!saved || saved.status !== 'failed' || !saved.content) throw new Error('Failed job missing or retry payload expired.');
        const job = await this.queue.getJob(id);
        if (job && job.status !== 'failed') throw new Error('Job is not retryable.');
        await this.store.resetFailed(id, tenantId);
        if (job) await this.queue.retry(id);
        else await this.queue.add('document-ingest', { id, tenantId }, id);
        await this.store.mark(id, 'queued');
    }

    private async bytes(payload: DocumentUploadPayload): Promise<Buffer> {
        if (payload.encoding !== undefined && payload.encoding !== 'base64' && payload.encoding !== 'utf8') throw new Error('Invalid encoding.');
        let data: Buffer;
        if (typeof payload.content === 'string') {
            if (Buffer.byteLength(payload.content) > (payload.encoding === 'base64' ? Math.ceil(this.maxBytes / 3) * 4 : this.maxBytes)) throw new IngestionQuotaError('Upload exceeds byte limit.');
            if (payload.encoding === 'base64' && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload.content)) throw new Error('Invalid base64 content.');
            data = Buffer.from(payload.content, payload.encoding === 'base64' ? 'base64' : 'utf8');
        } else if (Buffer.isBuffer(payload.content)) data = payload.content;
        else {
            const chunks: Buffer[] = []; let length = 0;
            for await (const chunk of payload.content as AsyncIterable<Buffer | string>) {
                const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                length += buffer.length;
                if (length > this.maxBytes) { (payload.content as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.(); throw new IngestionQuotaError('Upload exceeds byte limit.'); }
                chunks.push(buffer);
            }
            data = Buffer.concat(chunks);
        }
        if (!data.length || data.length > this.maxBytes) throw new IngestionQuotaError('Upload is empty or exceeds byte limit.');
        return data;
    }
}
