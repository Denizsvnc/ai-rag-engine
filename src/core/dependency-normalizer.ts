import type { EngineConfig } from '../interfaces/engine-config.interface.js';
import type {
    IVectorStore,
    IDocumentStore,
    IGraphStore,
    IIngestionStore,
    IBlobStore,
    StorageContainer
} from '../interfaces/storage.interface.js';
import type { IVectorStoreAdapter } from '../interfaces/vector.interface.js';
import type { IGraphAdapter } from '../interfaces/graph.interface.js';
import type { ICacheAdapter } from '../interfaces/cache.interface.js';
import type { IRulesAdapter } from '../interfaces/rules.interface.js';
import type { IFAQAdapter } from '../interfaces/faq.interface.js';
import type { IJobQueue } from './queue/job-queue.interface.js';
import { StorageCapabilityRegistry } from './storage/storage-capability-registry.js';
import { createStorage } from './storage/create-storage.js';
import { CacheManager } from './cache-manager.js';
import { MemoryVectorAdapter } from '../adapters/vector/memory-vector.adapter.js';
import { ToolRegistry } from './tool-registry.js';
import { SMLEngine } from './sml-engine.js';

export interface NormalizedEngineDependencies {
    vectorStore: IVectorStore | IVectorStoreAdapter;
    documentStore?: IDocumentStore | undefined;
    graphStore?: (IGraphStore & IGraphAdapter) | IGraphStore | IGraphAdapter | undefined;
    ingestionStore?: IIngestionStore | undefined;
    cacheAdapter: ICacheAdapter;
    blobStore?: IBlobStore | undefined;
    jobQueue?: IJobQueue | undefined;
    rulesAdapter?: IRulesAdapter | undefined;
    faqAdapter?: IFAQAdapter | undefined;
    toolRegistry?: ToolRegistry | undefined;
    storageContainer?: StorageContainer | undefined;
    capabilityRegistry: StorageCapabilityRegistry;
}

function hasSetSMLEngine(target: unknown): target is { setSMLEngine: (engine: SMLEngine) => void } {
    return typeof target === 'object' && target !== null && 'setSMLEngine' in target && typeof (target as { setSMLEngine: unknown }).setSMLEngine === 'function';
}

/**
 * Normalizes and unifies disparate storage and input configurations into a single source of truth.
 *
 * @remarks
 * Bridges legacy `inputs.*` and modern `storage.*` configurations, ensuring `RAGEngine`,
 * `AdaptiveIntelligenceOrchestrator`, and `DocumentIngestionService` operate on identical adapter instances.
 */
export function normalizeEngineDependencies(
    config: EngineConfig,
    smlEngine: SMLEngine
): NormalizedEngineDependencies {
    let storageContainer: StorageContainer | undefined;
    let capabilityRegistry: StorageCapabilityRegistry;

    if (config.storage) {
        storageContainer = 'healthCheck' in config.storage
            ? config.storage
            : createStorage(config.storage);
        capabilityRegistry = (storageContainer as unknown as { registry: StorageCapabilityRegistry }).registry;
    } else {
        capabilityRegistry = new StorageCapabilityRegistry();
    }

    // 1. Vector Store: storage.vectors -> inputs.vectorStore -> fallback MemoryVectorAdapter
    const vectorStore: IVectorStore | IVectorStoreAdapter =
        storageContainer?.config.vectors ??
        config.inputs?.vectorStore ??
        new MemoryVectorAdapter(smlEngine);

    if (hasSetSMLEngine(vectorStore)) {
        vectorStore.setSMLEngine(smlEngine);
    }

    // 2. Document Store: storage.documents -> inputs.documentStore
    const documentStore: IDocumentStore | undefined =
        storageContainer?.config.documents ??
        config.inputs?.documentStore;

    // 3. Graph Store: storage.graph -> inputs.graph
    const graphStore: (IGraphStore & IGraphAdapter) | IGraphStore | IGraphAdapter | undefined =
        (storageContainer?.config.graph as (IGraphStore & IGraphAdapter) | undefined) ??
        (config.inputs?.graph as (IGraphStore & IGraphAdapter) | undefined);

    // 4. Ingestion Store: storage.ingestion -> config.ingestion.backend
    const ingestionStore: IIngestionStore | undefined =
        storageContainer?.config.ingestion ??
        (config.ingestion?.backend as IIngestionStore | undefined);

    // 5. Cache Adapter: storage.cache -> config.cache.adapter -> fallback CacheManager
    let cacheAdapter: ICacheAdapter;
    if (storageContainer?.config.cache) {
        cacheAdapter = storageContainer.config.cache;
    } else if (config.cache?.adapter) {
        cacheAdapter = config.cache.adapter;
    } else {
        cacheAdapter = new CacheManager(
            config.cache?.filePath,
            config.cache?.minHitsToPersist,
            1000,
            config.cache?.ttlMs || 1000 * 60 * 60 * 24
        );
    }

    // 6. Blob Store: storage.blob
    const blobStore: IBlobStore | undefined = storageContainer?.config.blob;

    // 7. Job Queue: storage.queue -> config.ingestion.jobQueue
    const jobQueue: IJobQueue | undefined =
        storageContainer?.config.queue ??
        (config.ingestion?.jobQueue as IJobQueue | undefined);

    // 8. Rules & FAQ Adapters
    const rulesAdapter: IRulesAdapter | undefined = config.inputs?.rules;
    const faqAdapter: IFAQAdapter | undefined = config.inputs?.faq;
    if (hasSetSMLEngine(faqAdapter)) {
        faqAdapter.setSMLEngine(smlEngine);
    }

    // 9. Tool Registry
    let toolRegistry: ToolRegistry | undefined;
    if (config.tools && config.tools.items.length > 0) {
        toolRegistry = new ToolRegistry(smlEngine, config.tools.registryFilePath);
    }

    // Register all active stores in CapabilityRegistry if not already registered
    if (!config.storage) {
        capabilityRegistry.register('vectors', vectorStore.constructor.name, vectorStore);
        if (documentStore) {
            capabilityRegistry.register('documents', documentStore.constructor.name, documentStore);
        }
        if (graphStore) {
            capabilityRegistry.register('graph', graphStore.constructor.name, graphStore);
        }
        if (ingestionStore) {
            capabilityRegistry.register('ingestion', ingestionStore.constructor.name, ingestionStore);
        }
        if (cacheAdapter) {
            capabilityRegistry.register('cache', cacheAdapter.constructor.name, cacheAdapter);
        }
        if (blobStore) {
            capabilityRegistry.register('blobs', blobStore.constructor.name, blobStore);
        }
    }

    return {
        vectorStore,
        documentStore,
        graphStore,
        ingestionStore,
        cacheAdapter,
        blobStore,
        jobQueue,
        rulesAdapter,
        faqAdapter,
        toolRegistry,
        storageContainer,
        capabilityRegistry
    };
}
