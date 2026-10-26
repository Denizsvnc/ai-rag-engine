export interface ToolParameterSchema {
    type: 'object';
    properties: Record<string, {
        type: 'string' | 'number' | 'boolean' | 'array';
        description: string;
        enum?: string[];
    }>;
    required?: string[];
}

export interface IAgentTool<TArgs = any, TResult = any> {
    name: string;
    description: string; // Used by SML for intent routing and vector similarity
    parameters?: ToolParameterSchema;
    cacheResultTTL?: number;
    execute: (args: TArgs, context?: Record<string, any>) => Promise<TResult>;
}