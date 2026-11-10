export type JobStatus = 'pending' | 'queued' | 'processing' | 'completed' | 'failed';

export const JobStatusValues = {
    PENDING: 'pending',
    QUEUED: 'queued',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed',
} as const;

export interface Job<TData = any, TResult = any> {
    attemptsMade?: number | undefined;
    maxAttempts?: number | undefined;
    id: string;
    type: string;
    data: TData;
    status: JobStatus;
    progress: number; // 0 to 100
    result?: TResult | undefined;
    error?: string | undefined;
    createdAt: number;
    updatedAt: number;
    completedAt?: number | undefined;
}

export type JobHandler<TData = any, TResult = any> = (
    job: Job<TData, TResult>,
    updateProgress: (progress: number) => Promise<void> | void
) => Promise<TResult>;

export interface IJobQueue<TData = any, TResult = any> {
    add(type: string, data: TData, jobId?: string): Promise<Job<TData, TResult>>;
    getJob(id: string): Promise<Job<TData, TResult> | null>;
    process(type: string, handler: JobHandler<TData, TResult>): void | Promise<void>;
    close(): Promise<void>;
}
