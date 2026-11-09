import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { CustomLLMAdapter } from '../../src/adapters/llm/custom.adapter';
import { providerTimeoutSignal } from '../../src/utils/http';

test('provider timeout aborts a hung real HTTP request and invalid settings fail explicitly', async () => {
    const app = express();
    app.post('/', () => {});
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const old = process.env.LLM_TIMEOUT_MS;
    try {
        process.env.LLM_TIMEOUT_MS = '50';
        const llm = new CustomLLMAdapter({ endpoint: `http://127.0.0.1:${(server.address() as any).port}`, model: 'test' });
        const start = Date.now();
        await assert.rejects(llm.generate({ systemPrompt: 'test', userPrompt: 'hello' }), /timeout|aborted/i);
        assert.ok(Date.now() - start < 2000);
        for (const value of ['0', '-1', 'NaN']) { process.env.LLM_TIMEOUT_MS = value; assert.throws(() => providerTimeoutSignal(), /LLM_TIMEOUT_MS/); }
    } finally {
        if (old === undefined) delete process.env.LLM_TIMEOUT_MS; else process.env.LLM_TIMEOUT_MS = old;
        server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    }
});
