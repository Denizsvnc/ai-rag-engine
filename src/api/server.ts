import 'dotenv/config';
import express from 'express';
import { RAGEngine } from '../core/engine';
import { TieredLLMProvider } from '../adapters/llm/tiered.adapter';
import { StaticRulesAdapter } from '../adapters/rules/static-rules.adapter';
import { LocalFaqAdapter } from '../adapters/faq/local-faq.adapter';
import { createApiRoutes } from './routes';

async function bootstrap() {
    const app = express();
    app.use(express.json());

    // Dynamically resolve LLM provider from .env (OpenAI, Gemini, Ollama, Private LLM, or OpenRouter)
    let llmProvider;
    try {
        llmProvider = TieredLLMProvider.createFromEnv();
    } catch (err: any) {
        console.error('\n[Server Startup Error] Could not initialize LLM Provider:');
        console.error(err.message);
        console.error('\nPlease copy .env.example to .env and configure at least one LLM provider (OLLAMA_HOST, PRIVATE_LLM_ENDPOINT, OPENAI_API_KEY, or GEMINI_API_KEY).\n');
        process.exit(1);
    }

    // Configure and initialize RAG Engine with all layers
    const engine = new RAGEngine({
        llmProvider,
        inputs: {
            // 1. Static Business Rules
            rules: new StaticRulesAdapter([
                'Always maintain a polite, professional, and institutional tone.',
                'The return window for all standard purchases is 14 days.',
                'Never ask for or store visitor credit card numbers or passwords.'
            ]),
            // 2. Zero-token Semantic FAQ matching
            faq: new LocalFaqAdapter({
                filePath: './src/utils/faq-embeddings.json',
                defaultMatchThreshold: 0.80
            })
        },
        security: {
            enabled: true,
            blockHighRiskInjections: true,
            maxInputLength: 4000
        },
        cache: {
            enabled: true,
            filePath: './src/utils/query-cache.json'
        }
    });

    // Mount API routes
    app.use('/api', createApiRoutes(engine));

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`\n========================================================`);
        console.log(`🚀 Modular Enterprise RAG Engine is listening on port ${PORT}`);
        console.log(`📡 Query Endpoint  : POST http://localhost:${PORT}/api/query`);
        console.log(`💚 Health Endpoint : GET  http://localhost:${PORT}/api/health`);
        console.log(`========================================================\n`);
    });
}

bootstrap();