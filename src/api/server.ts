import Redis from 'ioredis';
import { resolveSecret } from '../core/security/secrets';
import { RedisConfirmationNonceStore } from '../core/security/nonce-store';
import 'dotenv/config';
import express from 'express';
import { RAGEngine } from '../core/engine';
import { TieredLLMProvider } from '../adapters/llm/tiered.adapter';
import { StaticRulesAdapter } from '../adapters/rules/static-rules.adapter';
import { LocalFaqAdapter } from '../adapters/faq/local-faq.adapter';
import { MemoryVectorAdapter } from '../adapters/vector/memory-vector.adapter';
import { createApiRoutes } from './routes';
import { ENGINE_DEFAULTS } from '../config/default';

async function bootstrap() {
    // Validate authentication keys before opening a listening socket.
    resolveSecret('JWT_SECRET');
    resolveSecret('CONFIRMATION_SECRET');
    let nonceStore: RedisConfirmationNonceStore | undefined;
    if (process.env.CONFIRMATION_REDIS_URL) {
        const redis = new Redis(process.env.CONFIRMATION_REDIS_URL, {
            lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false
        });
        redis.on('error', () => {}); // Connection errors are handled by connect/consume.
        await redis.connect();
        await redis.ping();
        nonceStore = new RedisConfirmationNonceStore(redis);
    }
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
        confirmation: { nonceStore },
        inputs: {
            // 1. In-memory & Persistent Vector Knowledge Base with Hybrid Search
            vectorStore: new MemoryVectorAdapter(),
            // 2. Static Business Rules
            rules: new StaticRulesAdapter([
                'Always maintain a polite, professional, and institutional tone.',
                'The return window for all standard purchases is 14 days.',
                'Never ask for or store visitor credit card numbers or passwords.'
            ]),
            // 3. Zero-token Semantic FAQ matching
            faq: new LocalFaqAdapter({
                filePath: './src/utils/faq-embeddings.json',
                defaultMatchThreshold: 0.80
            })
        },
        retrieval: {
            strategy: 'hybrid',
            topK: 3
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
    app.use('/api', createApiRoutes(engine, { auth: { allowDevAnonymous: process.env.ALLOW_ANONYMOUS_DEV_AUTH === 'true' } }));

    const PORT = Number(process.env.PORT) || ENGINE_DEFAULTS.SERVER.PORT;
    const HOST = process.env.HOST || ENGINE_DEFAULTS.SERVER.HOST;
    const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;

    app.listen(PORT, HOST, () => {
        console.log(`\n========================================================`);
        console.log(`🚀 Modular Enterprise RAG Engine is listening on http://${HOST}:${PORT}`);
        console.log(`📡 Query Endpoint  : POST http://${displayHost}:${PORT}/api/query`);
        console.log(`💚 Health Endpoint : GET  http://${displayHost}:${PORT}/api/health`);
        console.log(`========================================================\n`);
    });
}

bootstrap().catch(error => {
    console.error('[Server Startup Error]', error.message);
    process.exit(1);
});