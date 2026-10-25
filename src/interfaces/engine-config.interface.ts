import type { IVectorStoreAdapter } from './vector.interface';
import type { IRulesAdapter } from './rules.interface';
import type { IFAQAdapter } from './faq.interface';
import type { ICacheAdapter } from './cache.interface';
import type { IAgentTool } from './tool.interface';
import type { ILLMProvider } from './llm.interface';

export interface EngineConfig {
    llmProvider: ILLMProvider;
    smlConfig?: {
        enabled: boolean;
        modelName?: string; // Örn: 'Xenova/all-MiniLM-L6-v2'
        matchThreshold?: number; // Örn: 0.65
    };
    inputs: {
        vectorStore?: IVectorStoreAdapter;
        rules?: IRulesAdapter;
        faq?: IFAQAdapter;
    };
    tools?: {
        registryFilePath: string;
        items: IAgentTool[];
    };
    cache?: {
        enabled: boolean;
        filePath: string;
        minHitsToPersist?: number;
    };
}

export interface RAGResponse {
    answer: string;
    intent: string; // 'CACHE' | 'FAQ' | 'TOOL_CALL' | 'RAG_QUERY'
    resolvedBy: string;
    sources?: string[]; // Kullanılan doküman ID'leri
    appliedRules?: string[];
    executedTools?: Array<{ name: string; args: any }>;
    latencyMs: number;
}