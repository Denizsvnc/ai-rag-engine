import { randomUUID } from 'node:crypto';
import type { IJobQueue, Job, JobHandler, JobStatus } from './job-queue.interface.js';

export interface InMemoryQueueOptions {
    concurrency?: number | undefined;
    maxPendingJobs?: number | undefined;
    maxRetainedJobs?: number | undefined;
}

export class InMemoryJobQueue<TData = any, TResult = any> implements IJobQueue<TData, TResult> {
    private jobs = new Map<string, Job<TData, TResult>>();
    private handlers = new Map<string, JobHandler<TData, TResult>>();
    private pendingQueue: string[] = [];
    private activeJobsCount = 0;
    private isClosed = false;

    private readonly maxPendingJobs: number;
    private drainWaiters: Array<() => void> = [];
    private readonly concurrency: number;
    private readonly maxRetainedJobs: number;

    constructor(options?: InMemoryQueueOptions) {
        this.maxPendingJobs = options?.maxPendingJobs ?? 1000;
        this.concurrency = options?.concurrency ?? 2;
        this.maxRetainedJobs = options?.maxRetainedJobs ?? 500;
        for (const value of [this.concurrency, this.maxRetainedJobs, this.maxPendingJobs]) {
            if (!Number.isInteger(value) || value < 1) throw new Error('Queue limits must be positive integers.');
        }
    }

    public async add(type: string, data: TData, customJobId?: string): Promise<Job<TData, TResult>> {
        if (this.isClosed) {
            throw new Error('[InMemoryJobQueue] Queue is closed. Cannot add new jobs.');
        }

        const id = customJobId || `job_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
        const existing = this.jobs.get(id);
        if (existing) return { ...existing };
        if (this.pendingQueue.length + this.activeJobsCount >= this.maxPendingJobs) throw new Error('Pending job limit exceeded.');
        const now = Date.now();

        const job: Job<TData, TResult> = {
            id,
            type,
            data,
            status: 'queued',
            progress: 0,
            createdAt: now,
            updatedAt: now
        };

        this.jobs.set(id, job);
        this.pendingQueue.push(id);
        this.pruneOldJobs();

        // Trigger worker loop asynchronously
        setImmediate(() => this.dispatch());

        return { ...job };
    }

    public async getJob(id: string): Promise<Job<TData, TResult> | null> {
        const job = this.jobs.get(id);
        if (!job) return null;
        return { ...job };
    }

    public process(type: string, handler: JobHandler<TData, TResult>): void {
        this.handlers.set(type, handler);
        setImmediate(() => this.dispatch());
    }

    public async close(): Promise<void> {
        this.isClosed = true;
        this.pendingQueue = [];
        if (this.activeJobsCount > 0) await new Promise<void>(resolve => this.drainWaiters.push(resolve));
    }

    private async dispatch(): Promise<void> {
        if (this.isClosed || this.activeJobsCount >= this.concurrency) return;
        if (this.pendingQueue.length === 0) return;

        const nextJobId = this.pendingQueue.shift();
        if (!nextJobId) return;

        const job = this.jobs.get(nextJobId);
        if (!job || job.status !== 'queued') {
            this.dispatch();
            return;
        }

        const handler = this.handlers.get(job.type);
        if (!handler) {
            // Handler not registered yet; put back at front of queue to wait
            this.pendingQueue.unshift(nextJobId);
            return;
        }

        this.activeJobsCount++;
        job.status = 'processing';
        job.updatedAt = Date.now();

        const updateProgress = (progress: number) => {
            job.progress = Math.max(0, Math.min(100, progress));
            job.updatedAt = Date.now();
        };

        try {
            const result = await handler(job, updateProgress);
            job.status = 'completed';
            job.progress = 100;
            job.result = result;
            job.completedAt = Date.now();
            job.updatedAt = Date.now();
        } catch (error: any) {
            job.status = 'failed';
            job.error = error?.message || String(error);
            job.completedAt = Date.now();
            job.updatedAt = Date.now();
        } finally {
            this.activeJobsCount--;
            if (this.activeJobsCount === 0) { for (const resolve of this.drainWaiters) resolve(); this.drainWaiters = []; }
            this.pruneOldJobs();
            setImmediate(() => this.dispatch());
        }
    }

    private pruneOldJobs(): void {
        if (this.jobs.size <= this.maxRetainedJobs) return;
        const terminal = [...this.jobs.values()].filter(job => job.status === 'completed' || job.status === 'failed');
        for (const job of terminal.slice(0, Math.max(0, terminal.length - this.maxRetainedJobs))) this.jobs.delete(job.id);
    }
}
