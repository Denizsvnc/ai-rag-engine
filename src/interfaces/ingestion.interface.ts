import type { DocumentUploadPayload } from '../services/document-ingestion.service.js';
import type { Job, JobStatus } from '../core/queue/job-queue.interface.js';

export interface IIngestionBackend {
    submitDocument(payload: DocumentUploadPayload): Promise<{ jobId: string; status: JobStatus }>;
    getJobStatus(jobId: string, tenantId?: string): Promise<Job | null>;
    retryJob?(jobId: string, tenantId: string): Promise<void>;
}

export interface IngestionSettings {
    chunkSize: number;
    chunkOverlap: number;
}
