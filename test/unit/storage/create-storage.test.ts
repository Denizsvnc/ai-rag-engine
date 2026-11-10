import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStorage } from '../../../src/core/storage/create-storage.js';
import { SqliteVectorAdapter } from '../../../src/adapters/vector/sqlite-vector.adapter.js';
import { SqliteDocumentAdapter } from '../../../src/adapters/document/sqlite-document.adapter.js';
import { MemoryGraphAdapter } from '../../../src/adapters/graph/memory-graph.adapter.js';
import { MemoryBlobStore } from '../../../src/adapters/blob/memory-blob.adapter.js';
import { MemoryIngestionStore } from '../../../src/core/ingestion/memory-ingestion-store.js';
import { RAGEngine } from '../../../src/core/engine.js';
import type { ILLMProvider, ILLMRequest, ILLMResponse } from '../../../src/interfaces/llm.interface.js';

class MockLLM implements ILLMProvider {
    async generate(req: ILLMRequest): Promise<ILLMResponse> {
        return {
            content: 'Synthesized response based on storage container evidence.',
            usage: { promptTokens: 10, completionTokens: 10 }
        };
    }
}

describe('createStorage Factory & Unified Storage Orchestration', () => {
    it('initializes, health-checks, and validates capabilities across independent stores', async () => {
        const storage = createStorage({
            vectors: new SqliteVectorAdapter({ filePath: ':memory:' }),
            documents: new SqliteDocumentAdapter({ filePath: ':memory:' }),
            graph: new MemoryGraphAdapter(),
            blob: new MemoryBlobStore(),
            ingestion: new MemoryIngestionStore()
        });

        // 1. Concurrent initialization
        await storage.init();

        // 2. Health check
        const health = await storage.healthCheck();
        assert.equal(health['vectors']?.status, 'healthy');
        assert.equal(health['documents']?.status, 'healthy');
        assert.equal(health['graph']?.status, 'healthy');
        assert.equal(health['blob']?.status, 'healthy');
        assert.equal(health['ingestion']?.status, 'healthy');

        // 3. Capability validation
        const isValid = storage.validateCapabilities({
            vectors: ['denseVectorSearch', 'atomicDocumentReplacement'],
            graph: ['graphTraversal'],
            documents: ['metadataFiltering']
        });
        assert.equal(isValid, true);

        const isInvalid = storage.validateCapabilities({
            graph: ['denseVectorSearch' as any]
        });
        assert.equal(isInvalid, false);

        await storage.close();
    });

    it('injects unified storage container directly into RAGEngine without breaking legacy behavior', async () => {
        const sqliteVectors = new SqliteVectorAdapter({ filePath: ':memory:' });
        await sqliteVectors.init();
        await sqliteVectors.addDocuments([
            {
                id: 'rule_1',
                content: 'Corporate cloud retention policy is 90 days.',
                metadata: { tenantId: 'tenant_enterprise' }
            }
        ]);

        const storage = createStorage({
            vectors: sqliteVectors,
            graph: new MemoryGraphAdapter()
        });

        const engine = new RAGEngine({
            llmProvider: new MockLLM(),
            storage
        });
        await engine.init();

        // Inspect engine's capability registry
        const caps = engine.getStorageCapabilities();
        assert.equal(caps.hasCapability('vectors', 'denseVectorSearch'), true);
        assert.equal(caps.hasCapability('vectors', 'atomicDocumentReplacement'), true);

        // Execute query through storage container
        const res = await engine.query('What is the cloud retention policy?', {
            tenantId: 'tenant_enterprise'
        });
        assert.ok(res.answer.length > 0);
        assert.ok((res.sources ?? []).includes('rule_1'));

        await engine.close();
    });
});

