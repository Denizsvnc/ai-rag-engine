import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import { createApiRoutes } from '../../src/api/routes';
import { RAGEngine } from '../../src/core/engine';
import type { ILLMProvider, ILLMRequest, ILLMResponse } from '../../src/interfaces/llm.interface';

class MockApiLLM implements ILLMProvider {
    async generate(req: ILLMRequest): Promise<ILLMResponse> {
        return { content: 'API test response.' };
    }
}

describe('Integration - Express API Routes', () => {
    let app: express.Express;
    let server: Server;
    let baseUrl: string;

    before(async () => {
        app = express();
        app.use(express.json());

        const engine = new RAGEngine({
            llmProvider: new MockApiLLM(),
            inputs: {},
            cache: { enabled: false, filePath: './data/test-cache.json' }
        });

        app.use('/api', createApiRoutes(engine));

        await new Promise<void>((resolve) => {
            server = app.listen(0, () => {
                const address = server.address();
                if (typeof address === 'object' && address) {
                    baseUrl = `http://localhost:${address.port}`;
                }
                resolve();
            });
        });
    });

    after(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('GET /api/health should return ok and uptime', async () => {
        const res = await fetch(`${baseUrl}/api/health`);
        assert.equal(res.status, 200);

        const data: any = await res.json();
        assert.equal(data.status, 'ok');
        assert.ok(typeof data.uptime === 'number');
    });

    it('POST /api/query should process valid user query', async () => {
        const res = await fetch(`${baseUrl}/api/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: 'Merhaba' })
        });

        assert.equal(res.status, 200);
        const data: any = await res.json();
        assert.ok(typeof data.answer === 'string');
        assert.ok(typeof data.latencyMs === 'number');
    });

    it('POST /api/query should return 400 when query is missing', async () => {
        const res = await fetch(`${baseUrl}/api/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });

        assert.equal(res.status, 400);
        const data: any = await res.json();
        assert.ok(data.error.includes('zorunludur'));
    });
});
