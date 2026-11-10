// Interfaces & Types
export * from './interfaces/engine-config.interface.js';
export * from './interfaces/query-context.interface.js';
export * from './interfaces/tool.interface.js';
export * from './interfaces/vector.interface.js';
export * from './interfaces/faq.interface.js';
export * from './interfaces/rules.interface.js';
export * from './interfaces/cache.interface.js';
export * from './interfaces/llm.interface.js';
export * from './interfaces/strategy.interface.js';
export * from './interfaces/adaptive-config.interface.js';
export * from './interfaces/evidence.interface.js';
export * from './interfaces/graph.interface.js';
export * from './core/security/security.types.js';

// Core Engine & Orchestration
export { RAGEngine } from './core/engine.js';
export { SMLEngine, SMLModelPresets, type SMLModelPreset, type SMLEngineConfig, type EmbeddingExtractor, CircuitBreakerOpenError } from './core/sml-engine.js';
export { ToolRegistry } from './core/tool-registry.js';
export { CacheManager } from './core/cache-manager.js';
export { PromptBuilder, type PromptContext } from './core/prompt-builder.js';
export { TokenTracker, type EngineMetricsSummary, type ResponseMetrics, type TokenTrackerOptions } from './core/metrics/token-tracker.js';
export { PrometheusExporter, type PrometheusMetricOptions } from './core/metrics/prometheus-exporter.js';
export { RAGEvaluator, type RetrievalEvalResult, type FaithfulnessEvalResult, type FullRAGEvaluationReport } from './core/metrics/rag-evaluator.js';
export { BM25Index, type BM25Document } from './core/vector/bm25.js';
export { reciprocalRankFusion, type HybridScoredDocument } from './core/vector/hybrid-search.js';

// Security & Guardrails
export { SecurityGuard } from './core/security/security-guard.js';
export { InputSanitizer } from './core/security/sanitizer.js';
export { InjectionDetector, type DetectionResult } from './core/security/injection-detector.js';
export { PIIGuard, type PIIPolicy, type PIISanitizationResult } from './core/security/pii-guard.js';
export { ConfirmationService, type ConfirmationTicketPayload } from './core/security/confirmation.js';

// Asynchronous Queue & Ingestion
export * from './core/queue/job-queue.interface.js';
export { InMemoryJobQueue, type InMemoryQueueOptions } from './core/queue/in-memory-queue.js';
export { BullMQJobQueue, type BullMQQueueOptions } from './core/queue/bullmq-queue.js';
export { createJobQueue, type QueueConfig } from './core/queue/queue-factory.js';
export {
    DocumentIngestionService,
    type DocumentUploadPayload,
    type StreamIngestionOptions,
    type IngestionJobResult,
    type DocumentIngestionConfig
} from './services/document-ingestion.service.js';
export {
    RedisCacheAdapter,
    type IRedisClientLike,
    type RedisCacheOptions
} from './adapters/cache/redis-cache.adapter.js';

// API & Express Middleware
export { createRagMiddleware } from './api/middleware.js';
export { createApiRoutes, type ApiRouteOptions } from './api/routes.js';
export {
    createAuthToken,
    verifyAuthToken,
    createAuthMiddleware,
    requireRoles,
    type AuthTokenPayload,
    type AuthMiddlewareOptions
} from './api/auth.js';

// LLM Adapters
export { OpenAIAdapter, type OpenAIConfig } from './adapters/llm/openai.adapter.js';
export { GeminiAdapter, type GeminiConfig } from './adapters/llm/gemini.adapter.js';
export { OpenRouterAdapter, type OpenRouterConfig } from './adapters/llm/openrouter.adapter.js';
export { CustomLLMAdapter, type CustomLLMConfig } from './adapters/llm/custom.adapter.js';
export { OllamaAdapter, type OllamaConfig } from './adapters/llm/ollama.adapter.js';
export { FallbackLLMProvider, type FallbackProviderOptions } from './adapters/llm/fallback.adapter.js';
export { TieredLLMProvider, type TieredLLMConfig } from './adapters/llm/tiered.adapter.js';

// Data, Vector, Rules & FAQ Adapters
export { MemoryVectorAdapter } from './adapters/vector/memory-vector.adapter.js';
export { StaticRulesAdapter, type RuleInput } from './adapters/rules/static-rules.adapter.js';
export { UrlFaqAdapter } from './adapters/faq/url-faq.adapter.js';
export { LocalFaqAdapter, type LocalFaqAdapterOptions } from './adapters/faq/local-faq.adapter.js';
export { RedisConfirmationNonceStore, MemoryConfirmationNonceStore, type ConfirmationNonceStore } from './core/security/nonce-store.js';

export { PostgresVectorAdapter, type PostgresVectorOptions, type EmbeddingProvider } from './adapters/vector/postgres-vector.adapter.js';

export { PostgresIngestionStore, IngestionQuotaError, IngestionConflictError, type StoredUpload } from './core/ingestion/postgres-ingestion-store.js';
export { QueuedIngestionService, type QueuedIngestionOptions, type IngestionReference } from './core/ingestion/queued-ingestion.service.js';
export { IngestionWorker } from './core/ingestion/ingestion-worker.js';
export { createTenantRateLimiter } from './api/rate-limit.js';
export type { IIngestionBackend, IngestionSettings } from './interfaces/ingestion.interface.js';

// Adaptive Multi-Strategy Intelligence Architecture
export { AdaptiveIntelligenceOrchestrator } from './core/adaptive/adaptive-orchestrator.js';
export { StrategyRegistry } from './core/adaptive/strategy-registry.js';
export { AdaptiveQueryPlanner } from './core/adaptive/query-planner.js';
export { ExecutionScheduler } from './core/adaptive/execution-scheduler.js';
export { EvidenceFusionEngine } from './core/adaptive/evidence-fusion.js';
export { GraphExtractor } from './core/graph/graph-extractor.js';
export { MemoryGraphAdapter } from './adapters/graph/memory-graph.adapter.js';
export { PostgresGraphAdapter, type PostgresGraphOptions } from './adapters/graph/postgres-graph.adapter.js';

// Modular Database-Agnostic Storage Architecture
export {
    type StorageCapabilities,
    type IStorageCapabilities,
    UnsupportedStorageCapabilityError,
    type IDocumentStore,
    type StoredDocumentEntity,
    type IVectorStore,
    type IGraphStore,
    type IIngestionStore,
    type IBlobStore,
    type IEmbeddingProvider,
    type StorageContainerConfig,
    type StorageContainer
} from './interfaces/storage.interface.js';
export { StorageCapabilityRegistry, type ProviderRegistration } from './core/storage/storage-capability-registry.js';
export { createStorage } from './core/storage/create-storage.js';

// Storage & Persistence Providers
export { MemoryIngestionStore } from './core/ingestion/memory-ingestion-store.js';
export { SqliteVectorAdapter, type SqliteVectorOptions } from './adapters/vector/sqlite-vector.adapter.js';
export { SqliteDocumentAdapter, type SqliteDocumentOptions } from './adapters/document/sqlite-document.adapter.js';
export { MemoryBlobStore } from './adapters/blob/memory-blob.adapter.js';
export { LocalFsBlobStore, type LocalFsBlobOptions } from './adapters/blob/local-fs-blob.adapter.js';
export { MongoDocumentAdapter, type MongoDocumentOptions } from './adapters/document/mongo-document.adapter.js';
export { QdrantVectorAdapter, type QdrantVectorOptions } from './adapters/vector/qdrant-vector.adapter.js';
export { MySQLDocumentAdapter, type MySQLDocumentOptions } from './adapters/document/mysql-document.adapter.js';
export { Neo4jGraphAdapter, type Neo4jGraphOptions } from './adapters/graph/neo4j-graph.adapter.js';

// Strategies
export { TraditionalRAGStrategy } from './core/adaptive/strategies/traditional-rag.strategy.js';
export { SemanticSearchStrategy } from './core/adaptive/strategies/semantic-search.strategy.js';
export { HybridSearchStrategy } from './core/adaptive/strategies/hybrid-search.strategy.js';
export { SemanticGraphStrategy } from './core/adaptive/strategies/semantic-graph.strategy.js';
export { KnowledgeGraphStrategy } from './core/adaptive/strategies/knowledge-graph.strategy.js';
export { GraphRAGStrategy } from './core/adaptive/strategies/graph-rag.strategy.js';
export { KAGStrategy, type LogicalDeductionStep } from './core/adaptive/strategies/kag.strategy.js';
export { CAGStrategy, type CAGCacheType } from './core/adaptive/strategies/cag.strategy.js';
export { AgenticRAGStrategy } from './core/adaptive/strategies/agentic-rag.strategy.js';
