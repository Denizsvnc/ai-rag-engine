import type { IVectorStoreAdapter } from './vector.interface';
import type { IRulesAdapter } from './rules.interface';
import type { IFAQAdapter } from './faq.interface';
import type { ICacheAdapter } from './cache.interface';
import type { IAgentTool } from './tool.interface';
import type { ILLMProvider } from './llm.interface';
import type { SecurityConfig } from '../core/security/security.types';

export interface EngineConfig {
    llmProvider: ILLMProvider;
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
        filePath: string;
        minHitsToPersist?: number | undefined;
    } | undefined;
}

export interface RAGResponse {
    answer: string;
    intent: string; // 'CACHE' | 'FAQ' | 'TOOL_CALL' | 'RAG_QUERY' | 'SECURITY_BLOCKED'
    resolvedBy: string;
    sources?: string[] | undefined; // IDs of retrieved documents
    appliedRules?: string[] | undefined;
    executedTools?: Array<{ name: string; args: any }> | undefined;
    securityWarning?: string | undefined;
    latencyMs: number;
}