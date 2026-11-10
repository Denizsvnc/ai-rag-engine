import type { IIngestionBackend } from './ingestion.interface.js';
import type { IJobQueue } from '../core/queue/job-queue.interface.js';
import type { ConfirmationNonceStore } from '../core/security/nonce-store.js';
import type { IVectorStoreAdapter } from './vector.interface.js';
import type { IVectorStore, IDocumentStore, IGraphStore, StorageContainer, StorageContainerConfig } from './storage.interface.js';
import type { IRulesAdapter } from './rules.interface.js';
import type { IFAQAdapter } from './faq.interface.js';
import type { ICacheAdapter } from './cache.interface.js';
import type { IAgentTool } from './tool.interface.js';
import type { ILLMProvider } from './llm.interface.js';
import type { SecurityConfig } from '../core/security/security.types.js';
import type { ResponseMetrics, TokenTrackerOptions } from '../core/metrics/token-tracker.js';
import type { SMLModelPreset } from '../core/sml-engine.js';

/**
 * Enterprise configuration options for initializing the `RAGEngine`.
 * 
 * @example
 * ```typescript
 * const engine = new RAGEngine({
 *   llmProvider: new GeminiAdapter({ apiKey: process.env.GEMINI_API_KEY, model: 'gemini-3.6-flash' }),
 *   inputs: {
 *     vectorStore: new PostgresVectorAdapter({ connectionString: process.env.DATABASE_URL })
 *   },
 *   smlConfig: {
 *     enabled: true,
 *     modelName: SMLModelPresets.MULTILINGUAL, // 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
 *     matchThreshold: 0.65
 *   }
 * });
 * ```
 */
export interface EngineConfig {
    /**
     * Primary LLM Provider used for synthesizing final RAG answers.
     * Can be `GeminiAdapter`, `OpenAIAdapter`, `OllamaAdapter`, `TieredLLMProvider`, or `FallbackLLMProvider`.
     */
    llmProvider: ILLMProvider;

    /**
     * Cryptographic mutation confirmation settings for sensitive/destructive tool executions.
     */
    confirmation?: {
        /** HMAC secret used to sign confirmation tickets. */
        secret?: string | undefined;
        /** Single-use nonce store preventing replay attacks. */
        nonceStore?: ConfirmationNonceStore | undefined;
    } | undefined;

    /**
     * Enterprise Zero-Trust security guardrails: prompt injection detection, PII redaction (TCKN, IBAN, Credit Card), and boundary isolation.
     */
    security?: SecurityConfig | undefined;

    /**
     * Local Small Machine Learning (SML) engine configuration for sub-millisecond semantic routing, FAQ answering, and tool dispatching.
     * Runs locally in-process with zero external API calls.
     */
    smlConfig?: {
        /** Whether local semantic routing and embedding computation is enabled. Defaults to true. */
        enabled: boolean;
        /**
         * Hugging Face ONNX embedding model or preset.
         * Presets: `SMLModelPresets.ENGLISH_FAST`, `SMLModelPresets.MULTILINGUAL`, or `SMLModelPresets.MULTILINGUAL_ACCURATE`.
         * Can also be any custom HuggingFace model string (e.g. `'BAAI/bge-m3'`, `'intfloat/multilingual-e5-small'`).
         * Defaults to `'Xenova/all-MiniLM-L6-v2'`.
         */
        modelName?: string | SMLModelPreset | undefined;
        /** Minimum cosine similarity threshold (0.0 - 1.0) required to trigger FAQ matches or tool routing. Defaults to 0.65. */
        matchThreshold?: number | undefined;
        /** Model tensor quantization: 'q8' (default), 'fp32', 'fp16', or 'q4'. */
        dtype?: 'q8' | 'fp32' | 'fp16' | 'q4' | undefined;
        /** Directory where downloaded ONNX models are stored. Defaults to process.env.RAG_MODEL_CACHE_DIR or './data/models'. */
        cacheDir?: string | undefined;
        /** When true, only loads models already downloaded to disk. Defaults to false. */
        localFilesOnly?: boolean | undefined;
        /** Maximum number of embeddings held in RAM LRU cache. Defaults to 1000. */
        cacheSize?: number | undefined;
        /** Consecutive failures before tripping the circuit breaker OPEN. Defaults to 3. */
        circuitBreakerThreshold?: number | undefined;
        /** Cooldown period in ms before attempting recovery from OPEN circuit. Defaults to 15000 (15s). */
        circuitBreakerCooldownMs?: number | undefined;
    } | undefined;

    /**
     * Unified capability-driven storage container configuring independent document, vector, graph, cache, and ingestion backends.
     */
    storage?: StorageContainer | StorageContainerConfig | undefined;

    /**
     * Knowledge layers: vector store for unstructured documents, static business rules, and high-frequency FAQ entries.
     */
    inputs?: {
        /** Vector store adapter (`MemoryVectorAdapter`, `PostgresVectorAdapter`, `SqliteVectorAdapter`, or `QdrantVectorAdapter`). */
        vectorStore?: IVectorStore | IVectorStoreAdapter | undefined;
        /** Structured document store adapter (`MongoDocumentAdapter`, `SqliteDocumentAdapter`, or `MySQLDocumentAdapter`). */
        documentStore?: IDocumentStore | undefined;
        /** Business rules adapter (`StaticRulesAdapter`). */
        rules?: IRulesAdapter | undefined;
        /** Fast semantic FAQ adapter (`LocalFaqAdapter` or `UrlFaqAdapter`). */
        faq?: IFAQAdapter | undefined;
        /** Graph knowledge adapter (`MemoryGraphAdapter`, `PostgresGraphAdapter`, or `Neo4jGraphAdapter`). */
        graph?: IGraphStore | import('./graph.interface.js').IGraphAdapter | undefined;
    } | undefined;

    /**
     * Governed agent tools for live tool execution and dynamic function calling.
     */
    tools?: {
        /** Path to persist computed tool embeddings (e.g. './data/tool-registry.json'). */
        registryFilePath: string;
        /** Array of governed agent tools conforming to `IAgentTool`. */
        items: IAgentTool[];
    } | undefined;

    /**
     * Multi-tiered distributed caching configuration to serve repeated queries with sub-millisecond response time.
     */
    cache?: {
        /** Enable or disable semantic query caching. */
        enabled: boolean;
        /** Distributed cache adapter (`RedisCacheAdapter`). If omitted, uses fast in-memory LRU cache. */
        adapter?: ICacheAdapter | undefined;
        /** File path for persisting cache to disk across server restarts. */
        filePath?: string | undefined;
        /** Minimum frequency threshold before a response is persisted to disk. */
        minHitsToPersist?: number | undefined;
        /** Time-to-live for cached queries in milliseconds. Defaults to 24 hours. */
        ttlMs?: number | undefined;
        /** Time-to-live for cached tool execution results in milliseconds. */
        toolResultTtlMs?: number | undefined;
        /** Whether to cache tool execution results. */
        cacheToolResults?: boolean | undefined;
    } | undefined;

    /**
     * Hybrid search and document retrieval parameters.
     */
    retrieval?: {
        /** Search strategy: 'dense' (embeddings only), 'sparse' (BM25 keyword only), or 'hybrid' (RRF fusion). Defaults to 'hybrid'. */
        strategy?: 'dense' | 'sparse' | 'hybrid' | undefined;
        /** Maximum number of top relevant document chunks passed to the LLM prompt. Defaults to 5. */
        topK?: number | undefined;
        /** Minimum relevance score filter. */
        minRelevanceScore?: number | undefined;
    } | undefined;

    /**
     * FinOps telemetry options for token usage estimation and latency tracking.
     */
    metrics?: TokenTrackerOptions | undefined;

    /**
     * Durable background ingestion pipeline settings for PDF, Markdown, and text streams.
     */
    ingestion?: {
        /** Storage backend for uploaded documents (`PostgresIngestionStore`). */
        backend?: IIngestionBackend | undefined;
        /** Target text chunk length in characters. Defaults to 500. */
        chunkSize?: number | undefined;
        /** Sliding window overlap between chunks in characters. Defaults to 50. */
        chunkOverlap?: number | undefined;
        /** Background queue engine (`BullMQQueue` or `InMemoryJobQueue`). */
        jobQueue?: IJobQueue | undefined;
    } | undefined;

    /**
     * Adaptive Multi-Strategy Intelligence Architecture configuration.
     * When configured, dynamically orchestrates Traditional RAG, CAG, KAG, Graphs, and Agentic retrieval.
     */
    adaptive?: import('./adaptive-config.interface.js').AdaptiveIntelligenceConfig | undefined;
}

/**
 * Standardized response object returned by `engine.query()`.
 */
export interface RAGResponse {
    /** The final synthesized answer from LLM, FAQ match, or cached response. */
    answer: string;
    /** Resolved query intent: 'CACHE' | 'FAQ' | 'TOOL_CALL' | 'RAG_QUERY' | 'SECURITY_BLOCKED' | 'ADAPTIVE_INTELLIGENCE'. */
    intent: string;
    /** The component that resolved the request (e.g. 'InMemoryCache', 'LocalFaqAdapter', 'GeminiAdapter', 'AdaptiveOrchestrator'). */
    resolvedBy: string;
    /** Document IDs and titles retrieved from the vector store and cited in the answer. */
    sources?: string[] | undefined;
    /** Active business rules enforced during answer synthesis. */
    appliedRules?: string[] | undefined;
    /** Tools that were executed during the query lifecycle. */
    executedTools?: Array<{ name: string; args: unknown }> | undefined;
    /** Pending cryptographic confirmation tickets for mutating tool operations. */
    confirmationRequests?: Array<{ toolName: string; proposedArgs: unknown; confirmationTicket: string }> | undefined;
    /** Security alerts (e.g. prompt injection warnings, masked PII types). */
    securityWarning?: string | undefined;
    /** Total round-trip execution latency in milliseconds. */
    latencyMs: number;
    /** Token consumption and FinOps cost metrics. */
    metrics?: ResponseMetrics | undefined;
    /** Explainable decision metadata when adaptive intelligence orchestrates execution. */
    strategyDecision?: import('./adaptive-config.interface.js').StrategyDecisionExplanation | undefined;
    /** Full structured multi-strategy evidence context with provenance. */
    evidence?: import('./evidence.interface.js').EvidenceItem[] | undefined;
}