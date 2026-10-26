import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryJobQueue } from '../../src/core/queue/in-memory-queue';
import { createJobQueue } from '../../src/core/queue/queue-factory';
import { BullMQJobQueue } from '../../src/core/queue/bullmq-queue';

test('Asynchronous Queue - InMemory & BullMQ', async (t) => {
    await t.test('should process background jobs in FIFO order and report progress', async () => {
        const queue = new InMemoryJobQueue<{ text: string }, { count: number }>({ concurrency: 1 });
        let processed = 0;

        queue.process('count-words', async (job, updateProgress) => {
            updateProgress(50);
            processed++;
            return { count: job.data.text.split(' ').length };
        });

        const job = await queue.add('count-words', { text: 'one two three' });
        assert.equal(job.status, 'queued');

        // Allow async worker loop to execute
        await new Promise((res) => setTimeout(res, 30));

        const completedJob = await queue.getJob(job.id);
        assert.ok(completedJob);
        assert.equal(completedJob.status, 'completed');
        assert.equal(completedJob.progress, 100);
        assert.deepEqual(completedJob.result, { count: 3 });
        assert.equal(processed, 1);

        await queue.close();
    });

    await t.test('should capture worker errors and set job status to failed', async () => {
        const queue = new InMemoryJobQueue<{ causeFail: boolean }, any>();

        queue.process('fail-task', async () => {
            throw new Error('Simulated processing failure');
        });

        const job = await queue.add('fail-task', { causeFail: true });
        await new Promise((res) => setTimeout(res, 30));

        const failedJob = await queue.getJob(job.id);
        assert.ok(failedJob);
        assert.equal(failedJob.status, 'failed');
        assert.ok(failedJob.error?.includes('Simulated processing failure'));

        await queue.close();
    });

    await t.test('createJobQueue factory should default to InMemoryJobQueue when no redisUrl is provided', () => {
        const queue = createJobQueue();
        assert.ok(queue instanceof InMemoryJobQueue);
    });

    await t.test('BullMQJobQueue should produce actionable guidance when optional dependencies are absent', async () => {
        const bullQueue = new BullMQJobQueue({ redisUrl: 'redis://127.0.0.1:6379' });
        // Attempting to add a job without bullmq installed should reject with instructions
        await assert.rejects(
            async () => bullQueue.add('test', {}),
            (err: any) => err.message.includes("Run 'npm install bullmq ioredis'")
        );
    });
});
