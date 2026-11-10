import type { DocumentUploadPayload } from '../services/document-ingestion.service.js';
import type { Job, JobStatus } from '../core/queue/job-queue.interface.js';

/**
 * Common abstraction contract for asynchronous document ingestion backends.
 */
export interface IIngestionBackend {
    /**
     * Submits a document upload for asynchronous chunking and indexing.
     *
     * @param payload - Document upload parameters including buffer, tenantId, and metadata.
     * @returns Job reference with assigned job ID and initial status.
     */
    submitDocument(payload: DocumentUploadPayload): Promise<{ jobId: string; status: JobStatus }>;

    /**
     * Retrieves the status and progress of an ingestion job.
     *
     * @param jobId - Ingestion job identifier.
     * @param tenantId - Optional tenant identifier to enforce multi-tenant isolation.
     * @returns Current job record or null if not found.
     */
    getJobStatus(jobId: string, tenantId?: string): Promise<Job | null>;

    /**
     * Retries a previously failed ingestion job.
     *
     * @param jobId - Ingestion job identifier.
     * @param tenantId - Tenant identifier.
     */
    retryJob?(jobId: string, tenantId: string): Promise<void>;
}

/**
 * Text splitting and chunking parameters for document ingestion.
 */
export interface IngestionSettings {
    /** Target chunk size in characters or tokens. */
    chunkSize: number;
    /** Overlapping character or token window between adjacent chunks. */
    chunkOverlap: number;
}
