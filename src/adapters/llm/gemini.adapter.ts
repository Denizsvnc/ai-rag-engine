import type { ILLMProvider, ILLMRequest, ILLMResponse } from '../../interfaces/llm.interface';

export class GeminiAdapter implements ILLMProvider {
    private apiKey: string;
    private model: string;

    constructor(apiKey?: string, model?: string) {
        this.apiKey = apiKey || process.env.GEMINI_API_KEY || '';
        if (!this.apiKey) {
            throw new Error('[GeminiAdapter] API Key not found. Provide it in constructor or set GEMINI_API_KEY in .env');
        }
        this.model = model || process.env.GEMINI_MODEL || process.env.GEMINI_MODEL_FAST || 'gemini-1.5-flash';
    }

    public static createFast(apiKey?: string): GeminiAdapter {
        return new GeminiAdapter(apiKey, process.env.GEMINI_MODEL_FAST || 'gemini-1.5-flash');
    }

    public static createSmart(apiKey?: string): GeminiAdapter {
        return new GeminiAdapter(apiKey, process.env.GEMINI_MODEL_SMART || 'gemini-1.5-pro');
    }

    public async generate(request: ILLMRequest): Promise<ILLMResponse> {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

        const body: any = {
            contents: [
                {
                    role: 'user',
                    parts: [{ text: request.userPrompt }]
                }
            ],
            generationConfig: {
                temperature: 0.1, // Low temperature to reduce hallucination in RAG pipelines
            }
        };

        if (request.systemPrompt) {
            body.systemInstruction = {
                parts: [{ text: request.systemPrompt }]
            };
        }

        // Attach function declarations if tools are provided
        if (request.tools && request.tools.length > 0) {
            body.tools = [
                {
                    functionDeclarations: request.tools.map(tool => ({
                        name: tool.name,
                        description: tool.description,
                        ...(tool.parameters ? { parameters: tool.parameters } : {})
                    }))
                }
            ];
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`[Gemini API Error] ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const candidate = data.candidates?.[0];
        const parts = candidate?.content?.parts || [];

        let content = '';
        const toolCalls: Array<{ name: string; arguments: Record<string, any> }> = [];

        for (const part of parts) {
            if (part.text) {
                content += part.text;
            }
            if (part.functionCall) {
                toolCalls.push({
                    name: part.functionCall.name,
                    arguments: part.functionCall.args || {}
                });
            }
        }

        const result: ILLMResponse = {
            content,
            ...(toolCalls.length > 0 ? { toolCalls } : {}),
            ...(data.usageMetadata ? {
                usage: {
                    promptTokens: data.usageMetadata.promptTokenCount ?? 0,
                    completionTokens: data.usageMetadata.candidatesTokenCount ?? 0
                }
            } : {})
        };

        return result;
    }
}
