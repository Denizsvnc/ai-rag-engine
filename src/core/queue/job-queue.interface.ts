/**
 * Processing lifecycle statuses for asynchronous background jobs.
 */
export type JobStatus = 'pending' | 'queued' | 'processing' | 'completed' | 'failed';

/**
 * Constant values matching {@link JobStatus}.
 */
export const JobStatusValues = {
    PENDING: 'pending',
    QUEUED: 'queued',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed',
} as const;

/**
 * Generic background job instance descriptor.
 */
export interface Job<TData = unknown, TResult = unknown> {
    /** Number of execution attempts completed so far. */
    attemptsMade?: number | undefined;
    /** Maximum retry attempts configured for the job. */
    maxAttempts?: number | undefined;
    /** Unique job identifier. */
    id: string;
    /** Categorical job type string. */
    type: string;
    /** Job payload data. */
    data: TData;
    /** Current execution status. */
    status: JobStatus;
    /** Progress percentage from 0 to 100. */
    progress: number;
    /** Output result returned upon successful completion. */
    result?: TResult | undefined;
    /** Error message if execution failed. */
    error?: string | undefined;
    /** Unix timestamp (ms) when job was registered. */
    createdAt: number;
    /** Unix timestamp (ms) of latest state change. */
    updatedAt: number;
    /** Unix timestamp (ms) when job reached completed or failed state. */
    completedAt?: number | undefined;
}

/**
 * Async processing function invoked by workers to execute a queued job.
 */
export type JobHandler<TData = unknown, TResult = unknown> = (
    job: Job<TData, TResult>,
    updateProgress: (progress: number) => Promise<void> | void
) => Promise<TResult>;

/**
 * Common abstraction contract for asynchronous job queues.
 */
export interface IJobQueue<TData = unknown, TResult = unknown> {
    /**
     * Enqueues a new background job.
     *
     * @param type - Job type identifier.
     * @param data - Job payload data.
     * @param jobId - Optional custom job ID.
     * @returns Created job record.
     */
    add(type: string, data: TData, jobId?: string): Promise<Job<TData, TResult>>;

    /**
     * Retrieves a job by ID.
     *
     * @param id - Job identifier.
     * @returns Job record or null if not found.
     */
    getJob(id: string): Promise<Job<TData, TResult> | null>;

    /**
     * Registers a worker handler function for a job type.
     *
     * @param type - Job type to subscribe to.
     * @param handler - Worker function processing the job.
     */
    process(type: string, handler: JobHandler<TData, TResult>): void | Promise<void>;

    /**
     * Gracefully stops workers and releases queue connections.
     */
    close(): Promise<void>;
}
