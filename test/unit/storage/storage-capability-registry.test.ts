import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StorageCapabilityRegistry } from '../../../src/core/storage/storage-capability-registry.js';
import { UnsupportedStorageCapabilityError } from '../../../src/interfaces/storage.interface.js';
import { MemoryVectorAdapter } from '../../../src/adapters/vector/memory-vector.adapter.js';
import { MemoryGraphAdapter } from '../../../src/adapters/graph/memory-graph.adapter.js';
import { SqliteVectorAdapter } from '../../../src/adapters/vector/sqlite-vector.adapter.js';

describe('StorageCapabilityRegistry & Capability Negotiation', () => {
    it('registers storage providers and discovers declared capabilities', () => {
        const registry = new StorageCapabilityRegistry();
        const memVectors = new MemoryVectorAdapter();
        const memGraph = new MemoryGraphAdapter();

        registry.register('vectors', 'MemoryVectorAdapter', memVectors);
        registry.register('graph', 'MemoryGraphAdapter', memGraph);

        assert.equal(registry.hasCapability('vectors', 'denseVectorSearch'), true);
        assert.equal(registry.hasCapability('vectors', 'nativeHybridSearch'), true);
        assert.equal(registry.hasCapability('vectors', 'transactions'), false);

        assert.equal(registry.hasCapability('graph', 'graphTraversal'), true);
        assert.equal(registry.hasCapability('graph', 'denseVectorSearch'), false);
    });

    it('assertCapability throws UnsupportedStorageCapabilityError when capability or role is missing', () => {
        const registry = new StorageCapabilityRegistry();
        const memVectors = new MemoryVectorAdapter();
        registry.register('vectors', 'MemoryVectorAdapter', memVectors);

        // Missing capability on registered provider
        assert.throws(
            () => registry.assertCapability('vectors', 'transactions', 'Transactions required for rollback'),
            UnsupportedStorageCapabilityError
        );

        // Missing role
        assert.throws(
            () => registry.assertCapability('documents', 'metadataFiltering'),
            UnsupportedStorageCapabilityError
        );
    });

    it('negotiates optimal retrieval strategy accurately', () => {
        const registry = new StorageCapabilityRegistry();

        // No vector store registered
        assert.equal(registry.getOptimalRetrievalStrategy(), 'none');

        // Hybrid-capable provider (Memory or SQLite)
        const sqlite = new SqliteVectorAdapter({ filePath: ':memory:' });
        registry.register('vectors', 'SqliteVectorAdapter', sqlite);
        assert.equal(registry.getOptimalRetrievalStrategy(), 'native_hybrid');

        // Dense-only provider override
        registry.register('vectors', 'MockDenseVectorStore', {}, { denseVectorSearch: true, sparseRetrieval: false });
        assert.equal(registry.getOptimalRetrievalStrategy(), 'dense');

        // Sparse-only provider override
        registry.register('vectors', 'MockSparseStore', {}, { denseVectorSearch: false, sparseRetrieval: true });
        assert.equal(registry.getOptimalRetrievalStrategy(), 'sparse');
    });

    it('canExecuteGraphRAG returns true only when both graph and vector capabilities exist', () => {
        const registry = new StorageCapabilityRegistry();

        assert.equal(registry.canExecuteGraphRAG(), false);

        registry.register('vectors', 'MemoryVectorAdapter', new MemoryVectorAdapter());
        assert.equal(registry.canExecuteGraphRAG(), false);

        registry.register('graph', 'MemoryGraphAdapter', new MemoryGraphAdapter());
        assert.equal(registry.canExecuteGraphRAG(), true);
    });

    it('produces an exportable capability matrix', () => {
        const registry = new StorageCapabilityRegistry();
        registry.register('vectors', 'MemoryVectorAdapter', new MemoryVectorAdapter());
        registry.register('graph', 'MemoryGraphAdapter', new MemoryGraphAdapter());

        const matrix = registry.getMatrix();
        assert.ok(matrix['vectors']);
        assert.ok(matrix['graph']);
        assert.equal(matrix['vectors']!.provider, 'MemoryVectorAdapter');
        assert.equal(matrix['vectors']!.capabilities.denseVectorSearch, true);
    });
});

