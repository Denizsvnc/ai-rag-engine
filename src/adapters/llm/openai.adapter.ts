import type { ILLMProvider, ILLMRequest, ILLMResponse } from '../../interfaces/llm.interface';

export class OpenAIAdapter implements ILLMProvider {
    protected apiKey: string;
    protected model: string;
    protected endpoint: string;

    constructor(
        apiKey?: string,
        model?: string,
        endpoint?: string
    ) {
        this.apiKey = apiKey || process.env.OPENAI_API_KEY || '';
        if (!this.apiKey) {
            throw new Error('[OpenAIAdapter] API Key not found. Provide it in constructor or set OPENAI_API_KEY in .env');
        }
        this.model = model || process.env.OPENAI_MODEL || process.env.OPENAI_MODEL_FAST || 'gpt-4o-mini';
        this.endpoint = endpoint || process.env.OPENAI_ENDPOINT || 'https://api.openai.com/v1/chat/completions';
    }

    public static createFast(apiKey?: string): OpenAIAdapter {
        return new OpenAIAdapter(apiKey, process.env.OPENAI_MODEL_FAST || 'gpt-4o-mini');
    }

    public static createSmart(apiKey?: string): OpenAIAdapter {
        return new OpenAIAdapter(apiKey, process.env.OPENAI_MODEL_SMART || 'gpt-4o');
    }

    public async generate(request: ILLMRequest): Promise<ILLMResponse> {
        const messages = [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.userPrompt }
        ];

        const body: any = {
            model: this.model,
            messages,
            temperature: 0.1, // Low temperature to reduce hallucination in RAG pipelines
        };

        // Attach tool schemas if provided
        if (request.tools && request.tools.length > 0) {
            body.tools = request.tools.map(tool => ({
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters
                }
            }));
            body.tool_choice = 'auto';
        }

        const response = await fetch(this.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`[OpenAI API Error] ${response.status}: ${errorData}`);
        }

        const data = await response.json();
        const message = data.choices[0].message;

        const result: ILLMResponse = {
            content: message.content || '',
            usage: {
                promptTokens: data.usage.prompt_tokens,
                completionTokens: data.usage.completion_tokens
            }
        };

        // Parse tool call arguments if returned by the model
        if (message.tool_calls && message.tool_calls.length > 0) {
            result.toolCalls = message.tool_calls.map((tc: any) => ({
                name: tc.function.name,
                arguments: JSON.parse(tc.function.arguments)
            }));
        }

        return result;
    }
}