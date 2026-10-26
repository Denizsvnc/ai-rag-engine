import type { ConfirmationNonceStore } from '../core/security/nonce-store';
import type { IVectorStoreAdapter } from './vector.interface';
import type { IRulesAdapter } from './rules.interface';
import type { IFAQAdapter } from './faq.interface';
import type { ICacheAdapter } from './cache.interface';
import type { IAgentTool } from './tool.interface';
import type { ILLMProvider } from './llm.interface';
import type { SecurityConfig } from '../core/security/security.types';
import type { ResponseMetrics, TokenTrackerOptions } from '../core/metrics/token-tracker';

export interface EngineConfig {
    llmProvider: ILLMProvider;
    confirmation?: { secret?: string | undefined; nonceStore?: ConfirmationNonceStore | undefined } | undefined;
    security?: SecurityConfig | undefined;
    smlConfig?: {
        enabled: boolean;
        modelName?: string | undefined; // e.g. 'Xenova/all-MiniLM-L6-v2'
        matchThreshold?: number | undefined; // e.g. 0.65
    } | undefined;
    inputs: {
        vectorStore?: IVectorStoreAdapter | undefined;
        rules?: IRulesAdapter | undefined;
        faq?: IFAQAdapter | undefined;
    };
    tools?: {
        registryFilePath: string;
        items: IAgentTool[];
    } | undefined;
    cache?: {
        enabled: boolean;
        adapter?: ICacheAdapter | undefined;
        filePath?: string | undefined;
        minHitsToPersist?: number | undefined;
        ttlMs?: number | undefined;
        toolResultTtlMs?: number | undefined;
        cacheToolResults?: boolean | undefined;
    } | undefined;
    retrieval?: {
        strategy?: 'dense' | 'sparse' | 'hybrid' | undefined;
        topK?: number | undefined;
        minRelevanceScore?: number | undefined;
    } | undefined;
    metrics?: TokenTrackerOptions | undefined;
    ingestion?: {
        chunkSize?: number | undefined;
        chunkOverlap?: number | undefined;
        jobQueue?: any | undefined;
    } | undefined;
}

export interface RAGResponse {
    answer: string;
    intent: string; // 'CACHE' | 'FAQ' | 'TOOL_CALL' | 'RAG_QUERY' | 'SECURITY_BLOCKED'
    resolvedBy: string;
    sources?: string[] | undefined; // IDs of retrieved documents
    appliedRules?: string[] | undefined;
    executedTools?: Array<{ name: string; args: any }> | undefined;
    confirmationRequests?: Array<{ toolName: string; proposedArgs: unknown; confirmationTicket: string }> | undefined;
    securityWarning?: string | undefined;
    latencyMs: number;
    metrics?: ResponseMetrics | undefined;
}