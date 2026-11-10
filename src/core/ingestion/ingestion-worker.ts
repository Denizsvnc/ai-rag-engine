import { createHash } from 'node:crypto';
import type { IVectorStore } from '../../interfaces/storage.interface.js';
import { DocumentIngestionService } from '../../services/document-ingestion.service.js';
import { PIIGuard } from '../security/pii-guard.js';
import { QueuedIngestionService, type IngestionReference } from './queued-ingestion.service.js';
import type { Job } from '../queue/job-queue.interface.js';

/**
 * Background consumer processing document ingestion jobs from the queue.
 *
 * @remarks
 * Designed to execute in dedicated worker processes. Validates file integrity via SHA-256 digests,
 * performs pre-chunking PII masking, extracts text chunks, and executes atomic vector store replacement.
 *
 * @example
 * ```typescript
 * import { IngestionWorker, QueuedIngestionService, PostgresVectorAdapter } from '@denizsvnc/ai-rag-engine';
 *
 * const worker = new IngestionWorker(service, vectorAdapter);
 * await worker.start();
 * ```
 */
export class IngestionWorker {
    private timer: ReturnType<typeof setInterval> | undefined;
    private pump: Promise<void> | undefined;
    private stopped = false;

    /**
     * Initializes a new IngestionWorker instance.
     *
     * @param service - Queued ingestion service producer and outbox coordinator.
     * @param vectors - Vector adapter supporting atomic document replacement.
     * @param options - Polling interval and error callbacks.
     */
    constructor(
        private readonly service: QueuedIngestionService,
        private readonly vectors: Pick<Required<IVectorStore>, 'replaceDocument'>,
        private readonly options: { pollMs?: number; onError?: (error: unknown) => void } = {}
    ) {}

    /**
     * Connects to stores, starts queue consumer loops, and initiates outbox reconciliation.
     */
    public async start(): Promise<void> {
        if (this.timer) return;
        this.stopped = false;
        await this.service.store.ready();
        await this.service.queue.ready();
        await this.service.queue.process('document-ingest', (job, progress) => this.process(job, progress));
        await this.tick();
        this.timer = setInterval(() => { void this.tick(); }, this.options.pollMs ?? 1000);
    }

    private async tick(): Promise<void> {
        if (this.stopped) return;
        if (!this.pump) {
            this.pump = this.service.flushOutbox().then(() => this.service.store.expireFailedBlobs())
                .catch(error => this.options.onError?.(error)).finally(() => { this.pump = undefined; });
        }
        await this.pump;
    }

    private async process(job: Job<IngestionReference>, progress: (n: number) => Promise<void> | void): Promise<Record<string, unknown>> {
        const reference = job.data;
        const saved = await this.service.store.get(reference.id, reference.tenantId);
        if (!saved) throw new Error('Ingestion record missing.');
        if (saved.status === 'completed') return saved.result ?? {};
        if (!saved.content) throw new Error('Upload payload expired.');
        try {
            await this.service.store.mark(saved.id, 'processing');
            await progress(10);
            if (createHash('sha256').update(saved.content).digest('hex') !== saved.digest) throw new Error('Upload checksum mismatch.');
            const safety = DocumentIngestionService.validateFileSafety(saved.filename, saved.content);
            if (!safety.safe) throw new Error(`Unsafe document: ${safety.reason}`);
            const text = DocumentIngestionService.extractText(saved.filename, saved.content);
            // Sanitize before chunking so identifiers cannot escape detection across chunk boundaries.
            const sanitized = PIIGuard.sanitize(text);
            const pieces = DocumentIngestionService.chunkText(sanitized.sanitizedText, saved.settings.chunkSize, saved.settings.chunkOverlap);
            if (!pieces.length) throw new Error('Document contains no extractable text.');
            const docs = pieces.map((content, index) => ({
                id: createHash('sha256').update(JSON.stringify([saved.documentId, index])).digest('hex'), content,
                metadata: { tenantId: saved.tenantId, documentId: saved.documentId, documentVersion: saved.version,
                    filename: saved.filename, chunkIndex: index, totalChunks: pieces.length, sourceDigest: saved.digest }
            }));
            await progress(40);
            const outcome = await this.vectors.replaceDocument(saved.documentId, saved.tenantId, saved.version, docs);
            const result = { filename: saved.filename, documentId: saved.documentId, version: saved.version,
                chunksCount: docs.length, piiEntitiesMasked: sanitized.detectedEntities.length, documentIds: docs.map(doc => doc.id),
                superseded: outcome === 'superseded', applied: outcome === 'applied', processedAt: new Date().toISOString() };
            await this.service.store.complete(saved.id, result);
            await progress(100);
            return result;
        } catch (error) {
            if ((job.attemptsMade ?? 0) + 1 >= (job.maxAttempts ?? 1)) {
                await this.service.store.mark(saved.id, 'failed', error instanceof Error ? error.message : 'Processing failed.');
            }
            throw error;
        }
    }

    /**
     * Gracefully stops the worker, clears polling intervals, and closes backing queue connections.
     */
    public async close(): Promise<void> {
        this.stopped = true;
        if (this.timer) { clearInterval(this.timer); this.timer = undefined; }
        await this.pump;
        await this.service.queue.close();
    }
}
