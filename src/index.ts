// Interfaces & Types
export * from './interfaces/engine-config.interface';
export * from './interfaces/tool.interface';
export * from './interfaces/vector.interface';
export * from './interfaces/faq.interface';
export * from './interfaces/rules.interface';
export * from './interfaces/cache.interface';
export * from './interfaces/llm.interface';
export * from './core/security/security.types';

// Core Engine & Orchestration
export { RAGEngine } from './core/engine';
export { SMLEngine, type SMLEngineConfig } from './core/sml-engine';
export { ToolRegistry } from './core/tool-registry';
export { CacheManager } from './core/cache-manager';
export { PromptBuilder, type PromptContext } from './core/prompt-builder';

// Security & Guardrails
export { SecurityGuard } from './core/security/security-guard';
export { InputSanitizer } from './core/security/sanitizer';
export { InjectionDetector, type DetectionResult } from './core/security/injection-detector';

// API & Express Middleware
export { createRagMiddleware } from './api/middleware';
export { createApiRoutes } from './api/routes';

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