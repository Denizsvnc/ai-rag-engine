import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Redis from 'ioredis';
import { ConfirmationService } from '../../src/core/security/confirmation';
import { RedisConfirmationNonceStore } from '../../src/core/security/nonce-store';

const exec = promisify(execFile);
test('Redis consumes a ticket once across independent Node processes and service restarts', { skip: !process.env.REDIS_TEST_URL }, async () => {
    const url = process.env.REDIS_TEST_URL!;
    const secret = 'distributed-test-secret-at-least-32-bytes';
    const client = new Redis(url, { maxRetriesPerRequest: 1 });
    client.on('error', () => {});
    try {
        await client.ping();
        const target = { toolName: 'delete', args: { id: 1 }, tenantId: 'alpha', userId: 'alice' };
        const service = new ConfirmationService(secret, undefined, new RedisConfirmationNonceStore(client));
        const ticket = service.issueTicket(target);
        const script = `
            import Redis from 'ioredis';
            import { ConfirmationService } from './src/core/security/confirmation.ts';
            import { RedisConfirmationNonceStore } from './src/core/security/nonce-store.ts';
            const client = new Redis(process.env.REDIS_TEST_URL, { maxRetriesPerRequest: 1 });
            const service = new ConfirmationService(process.env.TEST_TICKET_SECRET, undefined, new RedisConfirmationNonceStore(client));
            try { await service.verifyTicket(process.env.TEST_TICKET, ${JSON.stringify(target)}); console.log('accepted'); }
            catch { console.log('denied'); }
            finally { await client.quit(); }
        `;
        const run = () => exec(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
            env: { ...process.env, TEST_TICKET: ticket, TEST_TICKET_SECRET: secret }
        });
        const results = await Promise.all(Array.from({ length: 8 }, run));
        assert.equal(results.filter(result => result.stdout.trim() === 'accepted').length, 1);
        assert.equal((await run()).stdout.trim(), 'denied');
        const nonce = JSON.parse(Buffer.from(ticket.split('.')[0]!, 'base64url').toString()).nonce;
        const remainingTtl = await client.pttl(`rag:confirmation:${nonce}`);
        assert.ok(remainingTtl > 0 && remainingTtl <= 300_000, 'Consumed nonce must have bounded Redis TTL');
        const expiryService = new ConfirmationService(secret, 30, new RedisConfirmationNonceStore(client));
        const expiryTicket = expiryService.issueTicket(target);
        await new Promise(resolve => setTimeout(resolve, 40));
        await assert.rejects(expiryService.verifyTicket(expiryTicket, target), /expired/);
    } finally {
        await client.quit();
    }
});
