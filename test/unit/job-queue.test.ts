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

    await t.test('BullMQ rejects unsafe limits before connecting', () => {
        assert.throws(() => new BullMQJobQueue({ attempts: 0 }), /positive integer/);
        assert.throws(() => new BullMQJobQueue({ concurrency: 0 }), /positive integer/);
    });
});

test('memory queue bounds pending jobs and never prunes active work', async () => {
    const queue = new InMemoryJobQueue({ concurrency: 1, maxPendingJobs: 2, maxRetainedJobs: 1 });
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    queue.process('work', async () => { await gate; return 'done'; });
    const first = await queue.add('work', {}, 'same');
    assert.equal((await queue.add('work', {}, 'same')).id, first.id);
    await queue.add('work', {}, 'second');
    await assert.rejects(queue.add('work', {}, 'third'), /limit/);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await queue.getJob(first.id))?.status, 'processing');
    const closing = queue.close(); finish(); await closing;
    assert.equal((await queue.getJob(first.id))?.status, 'completed');
    await assert.rejects(queue.add('work', {}), /closed/i);
});
