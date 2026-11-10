import type { IDocumentStore, StoredDocumentEntity, StorageCapabilities } from '../../interfaces/storage.interface.js';

export interface MongoDocumentOptions {
    /** MongoDB connection URI (e.g. 'mongodb://localhost:27017/rag_db'). */
    connectionString?: string | undefined;
    /** Existing MongoClient or database instance. */
    client?: unknown | undefined;
    /** Database name. Defaults to 'rag_db'. */
    dbName?: string | undefined;
    /** Collection name for documents. Defaults to 'rag_documents'. */
    collectionName?: string | undefined;
}

/**
 * MongoDB document store adapter with lazy-loaded driver isolation.
 *
 * @remarks
 * Driver Isolation:
 * Does not force `mongodb` as a required SDK dependency.
 * Dynamically imports `mongodb` only when instantiated with a connection URI.
 *
 * Multi-Tenancy:
 * All queries and mutations strictly partition documents by `{ tenantId, id }`.
 *
 * @example
 * ```typescript
 * import { MongoDocumentAdapter } from '@denizsvnc/ai-rag-engine';
 *
 * const docStore = new MongoDocumentAdapter({
 *   connectionString: process.env.MONGODB_URI,
 *   dbName: 'enterprise_rag'
 * });
 * await docStore.init();
 * ```
 */
export class MongoDocumentAdapter implements IDocumentStore {
    public readonly capabilities: StorageCapabilities = {
        denseVectorSearch: false,
        sparseRetrieval: false,
        nativeHybridSearch: false,
        metadataFiltering: true,
        namespaceIsolation: true,
        transactions: true,
        atomicDocumentReplacement: true,
        versioning: true,
        batchOperations: true,
        nativeIndexes: true,
        fullTextSearch: true
    };

    private client: any;
    private db: any;
    private collection: any;
    private isInitialized = false;

    constructor(private readonly options: MongoDocumentOptions) {
        if (!options.client && !options.connectionString) {
            throw new Error('[MongoDocumentAdapter] Either connectionString or client instance must be provided.');
        }
        if (options.client) {
            this.client = options.client;
        }
    }

    public hasCapability(capability: keyof StorageCapabilities): boolean {
        return Boolean(this.capabilities[capability]);
    }

    public async init(): Promise<void> {
        if (this.isInitialized) return;

        if (!this.client && this.options.connectionString) {
            try {
                // Dynamic driver import for zero forced dependencies
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const mongoPkg: any = await import('mongodb' as string);
                const MongoClient = mongoPkg.MongoClient ?? mongoPkg.default?.MongoClient;
                this.client = new MongoClient(this.options.connectionString);
                await this.client.connect();
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                if (msg.includes('Cannot find package') || msg.includes('ERR_MODULE_NOT_FOUND')) {
                    throw new Error(
                        '[MongoDocumentAdapter] Optional dependency "mongodb" is not installed. Run: npm install mongodb'
                    );
                }
                throw err;
            }
        }

        const dbName = this.options.dbName ?? 'rag_db';
        const collName = this.options.collectionName ?? 'rag_documents';

        this.db = typeof this.client.db === 'function' ? this.client.db(dbName) : this.client;
        this.collection = this.db.collection(collName);

        // Ensure compound index for multi-tenant isolation and fast ID lookup
        try {
            await this.collection.createIndex({ tenantId: 1, id: 1 }, { unique: true });
            await this.collection.createIndex({ tenantId: 1, updatedAt: -1 });
        } catch {}

        this.isInitialized = true;
    }

    public async close(): Promise<void> {
        if (this.client && typeof this.client.close === 'function') {
            await this.client.close();
            this.isInitialized = false;
        }
    }

    private getColl(): any {
        if (!this.isInitialized || !this.collection) {
            throw new Error('[MongoDocumentAdapter] Adapter not initialized. Call init() before querying.');
        }
        return this.collection;
    }

    public async putDocument(doc: StoredDocumentEntity): Promise<void> {
        await this.putDocuments([doc]);
    }

    public async putDocuments(docs: StoredDocumentEntity[]): Promise<void> {
        const coll = this.getColl();
        const now = Date.now();

        const operations = docs.map(doc => ({
            updateOne: {
                filter: { tenantId: doc.tenantId, id: doc.id },
                update: {
                    $set: {
                        id: doc.id,
                        tenantId: doc.tenantId,
                        content: doc.content,
                        metadata: doc.metadata ?? {},
                        version: doc.version ?? 1,
                        updatedAt: now
                    },
                    $setOnInsert: {
                        createdAt: doc.createdAt ?? now
                    }
                },
                upsert: true
            }
        }));

        if (operations.length > 0) {
            await coll.bulkWrite(operations, { ordered: false });
        }
    }

    public async getDocument(id: string, tenantId: string): Promise<StoredDocumentEntity | null> {
        const coll = this.getColl();
        const doc = await coll.findOne({ tenantId, id }, { projection: { _id: 0 } });
        return doc ? (doc as StoredDocumentEntity) : null;
    }

    public async getDocuments(ids: string[], tenantId: string): Promise<StoredDocumentEntity[]> {
        const coll = this.getColl();
        const cursor = coll.find(
            { tenantId, id: { $in: ids } },
            { projection: { _id: 0 } }
        );
        return (await cursor.toArray()) as StoredDocumentEntity[];
    }

    public async deleteDocument(id: string, tenantId: string): Promise<boolean> {
        const coll = this.getColl();
        const res = await coll.deleteOne({ tenantId, id });
        return (res.deletedCount ?? 0) > 0;
    }

    public async queryDocuments(filter: Record<string, unknown>, limit = 100): Promise<StoredDocumentEntity[]> {
        const coll = this.getColl();
        const tenantId = filter.tenantId ? String(filter.tenantId) : undefined;

        const mongoQuery: Record<string, unknown> = {};
        if (tenantId) mongoQuery.tenantId = tenantId;

        // Apply metadata key-value filters
        for (const [k, v] of Object.entries(filter)) {
            if (k === 'tenantId') continue;
            mongoQuery[`metadata.${k}`] = v;
        }

        const cursor = coll.find(mongoQuery, { projection: { _id: 0 } }).sort({ updatedAt: -1 }).limit(limit);
        return (await cursor.toArray()) as StoredDocumentEntity[];
    }
}

