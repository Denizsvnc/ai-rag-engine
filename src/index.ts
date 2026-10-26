// Interfaces & Types
export * from './interfaces/engine-config.interface';
export * from './interfaces/query-context.interface';
export * from './interfaces/tool.interface';
export * from './interfaces/vector.interface';
export * from './interfaces/faq.interface';
export * from './interfaces/rules.interface';
export * from './interfaces/cache.interface';
export * from './interfaces/llm.interface';
export * from './core/security/security.types';

// Core Engine & Orchestration
export { RAGEngine } from './core/engine';
export { SMLEngine, type SMLEngineConfig, CircuitBreakerOpenError } from './core/sml-engine';
export { ToolRegistry } from './core/tool-registry';
export { CacheManager } from './core/cache-manager';
export { PromptBuilder, type PromptContext } from './core/prompt-builder';
export { TokenTracker, type EngineMetricsSummary, type ResponseMetrics, type TokenTrackerOptions } from './core/metrics/token-tracker';
export { PrometheusExporter, type PrometheusMetricOptions } from './core/metrics/prometheus-exporter';
export { RAGEvaluator, type RetrievalEvalResult, type FaithfulnessEvalResult, type FullRAGEvaluationReport } from './core/metrics/rag-evaluator';
export { BM25Index, type BM25Document } from './core/vector/bm25';
export { reciprocalRankFusion, type HybridScoredDocument } from './core/vector/hybrid-search';

// Security & Guardrails
export { SecurityGuard } from './core/security/security-guard';
export { InputSanitizer } from './core/security/sanitizer';
export { InjectionDetector, type DetectionResult } from './core/security/injection-detector';
export { PIIGuard, type PIIPolicy, type PIISanitizationResult } from './core/security/pii-guard';
export { ConfirmationService, type ConfirmationTicketPayload } from './core/security/confirmation';

// Asynchronous Queue & Ingestion
export * from './core/queue/job-queue.interface';
export { InMemoryJobQueue, type InMemoryQueueOptions } from './core/queue/in-memory-queue';
export { BullMQJobQueue, type BullMQQueueOptions } from './core/queue/bullmq-queue';
export { createJobQueue, type QueueConfig } from './core/queue/queue-factory';
export {
    DocumentIngestionService,
    type DocumentUploadPayload,
    type StreamIngestionOptions,
    type IngestionJobResult,
    type DocumentIngestionConfig
} from './services/document-ingestion.service';
export {
    RedisCacheAdapter,
    type IRedisClientLike,
    type RedisCacheOptions
} from './adapters/cache/redis-cache.adapter';

// API & Express Middleware
export { createRagMiddleware } from './api/middleware';
export { createApiRoutes, type ApiRouteOptions } from './api/routes';
export {
    createAuthToken,
    verifyAuthToken,
    createAuthMiddleware,
    requireRoles,
    type AuthTokenPayload,
    type AuthMiddlewareOptions
} from './api/auth';

// LLM Adapters
export { OpenAIAdapter } from './adapters/llm/openai.adapter';
export { GeminiAdapter } from './adapters/llm/gemini.adapter';
export { OpenRouterAdapter } from './adapters/llm/openrouter.adapter';
export { CustomLLMAdapter, type CustomLLMConfig } from './adapters/llm/custom.adapter';
export { OllamaAdapter, type OllamaConfig } from './adapters/llm/ollama.adapter';
export { FallbackLLMProvider, type FallbackProviderOptions } from './adapters/llm/fallback.adapter';
export { TieredLLMProvider, type TieredLLMConfig } from './adapters/llm/tiered.adapter';

// Data, Vector, Rules & FAQ Adapters
export { MemoryVectorAdapter } from './adapters/vector/memory-vector.adapter';
export { StaticRulesAdapter } from './adapters/rules/static-rules.adapter';
export { UrlFaqAdapter } from './adapters/faq/url-faq.adapter';
export { LocalFaqAdapter, type LocalFaqAdapterOptions } from './adapters/faq/local-faq.adapter';
export { RedisConfirmationNonceStore, MemoryConfirmationNonceStore, type ConfirmationNonceStore } from './core/security/nonce-store';
