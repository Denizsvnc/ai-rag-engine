import type { IAgentTool } from './tool.interface';

export interface ILLMRequest {
    systemPrompt: string;
    userPrompt: string;
    tools?: IAgentTool[];
}

export interface ILLMResponse {
    content: string;
    toolCalls?: Array<{
        name: string;
        arguments: Record<string, any>;
    }>;
    usage?: {
        promptTokens: number;
        completionTokens: number;
    };
}

export interface ILLMProvider {
    generate(request: ILLMRequest): Promise<ILLMResponse>;
}