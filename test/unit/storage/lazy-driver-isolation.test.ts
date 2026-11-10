import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MongoDocumentAdapter } from '../../../src/adapters/document/mongo-document.adapter.js';
import { MySQLDocumentAdapter } from '../../../src/adapters/document/mysql-document.adapter.js';
import { Neo4jGraphAdapter } from '../../../src/adapters/graph/neo4j-graph.adapter.js';
import { QdrantVectorAdapter } from '../../../src/adapters/vector/qdrant-vector.adapter.js';

describe('Lazy Driver Isolation & Optional Dependency Graceful Degradation', () => {
    it('MongoDocumentAdapter throws clear actionable error when optional mongodb driver is not installed', async () => {
        const adapter = new MongoDocumentAdapter({
            connectionString: 'mongodb://localhost:27017/uninstalled_test'
        });

        await assert.rejects(
            () => adapter.init(),
            /Optional dependency "mongodb" is not installed/
        );
    });

    it('MySQLDocumentAdapter throws clear actionable error when optional mysql2 driver is not installed', async () => {
        const adapter = new MySQLDocumentAdapter({
            host: '127.0.0.1',
            database: 'test_db'
        });

        await assert.rejects(
            () => adapter.init(),
            /Optional dependency "mysql2" is not installed/
        );
    });

    it('Neo4jGraphAdapter throws clear actionable error when optional neo4j-driver is not installed', async () => {
        const adapter = new Neo4jGraphAdapter({
            url: 'bolt://localhost:7687'
        });

        await assert.rejects(
            () => adapter.init(),
            /Optional dependency "neo4j-driver" is not installed/
        );
    });

    it('QdrantVectorAdapter operates via standard fetch and initializes without extra packages', async () => {
        const adapter = new QdrantVectorAdapter({
            url: 'http://127.0.0.1:6333',
            collectionName: 'test_collection'
        });

        // Does not throw module import errors because it uses standard global fetch
        await adapter.init();
        assert.equal(adapter.capabilities.denseVectorSearch, true);
        assert.equal(adapter.capabilities.atomicDocumentReplacement, true);
    });

    it('MongoDocumentAdapter functions properly when provided with a mock client instance', async () => {
        const memoryCollection = new Map<string, any>();
        const mockColl = {
            createIndex: async () => {},
            bulkWrite: async (ops: any[]) => {
                for (const op of ops) {
                    const key = `${op.updateOne.filter.tenantId}:${op.updateOne.filter.id}`;
                    memoryCollection.set(key, op.updateOne.update.$set);
                }
            },
            findOne: async (filter: any) => {
                const key = `${filter.tenantId}:${filter.id}`;
                return memoryCollection.get(key) ?? null;
            },
            deleteOne: async (filter: any) => {
                const key = `${filter.tenantId}:${filter.id}`;
                const deleted = memoryCollection.delete(key);
                return { deletedCount: deleted ? 1 : 0 };
            }
        };

        const mockDb = {
            collection: () => mockColl
        };

        const mockClient = {
            db: () => mockDb,
            close: async () => {}
        };

        const adapter = new MongoDocumentAdapter({ client: mockClient });
        await adapter.init();

        await adapter.putDocument({
            id: 'mongo_doc_1',
            tenantId: 'tenant_alpha',
            content: 'Mongo stored document content',
            metadata: { tag: 'database' }
        });

        const doc = await adapter.getDocument('mongo_doc_1', 'tenant_alpha');
        assert.ok(doc);
        assert.equal(doc.content, 'Mongo stored document content');

        const nonExistent = await adapter.getDocument('mongo_doc_1', 'tenant_beta');
        assert.equal(nonExistent, null, 'Multi-tenant isolation must reject foreign tenant document access');

        await adapter.close();
    });
});

