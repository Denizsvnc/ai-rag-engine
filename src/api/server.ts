import 'dotenv/config';
import Redis from 'ioredis';
import express, { type ErrorRequestHandler } from 'express';
import { RAGEngine } from '../core/engine.js';
import { TieredLLMProvider } from '../adapters/llm/tiered.adapter.js';
import { StaticRulesAdapter } from '../adapters/rules/static-rules.adapter.js';
import { LocalFaqAdapter } from '../adapters/faq/local-faq.adapter.js';
import { MemoryVectorAdapter } from '../adapters/vector/memory-vector.adapter.js';
import { PostgresVectorAdapter } from '../adapters/vector/postgres-vector.adapter.js';
import { RedisCacheAdapter } from '../adapters/cache/redis-cache.adapter.js';
import { createApiRoutes } from './routes.js';
import { createTenantRateLimiter } from './rate-limit.js';
import { resolveSecret } from '../core/security/secrets.js';
import { RedisConfirmationNonceStore } from '../core/security/nonce-store.js';
import { createIngestionRuntime, persistentVectorsFromEnv, positiveEnv } from '../config/ingestion-runtime.js';
import { ENGINE_DEFAULTS } from '../config/default.js';

async function bootstrap() {
    resolveSecret('JWT_SECRET'); resolveSecret('CONFIRMATION_SECRET');
    const mode = process.env.INGESTION_QUEUE ?? (process.env.NODE_ENV === 'production' ? 'bullmq' : 'memory');
    if (!['bullmq', 'memory'].includes(mode)) throw new Error('INGESTION_QUEUE must be memory or bullmq.');
    const driver = process.env.VECTOR_STORE ?? (mode === 'bullmq' ? 'postgres' : 'memory');
    if (!['postgres', 'memory'].includes(driver)) throw new Error('VECTOR_STORE must be memory or postgres.');
    if (mode === 'bullmq' && driver !== 'postgres') throw new Error('Distributed ingestion requires a shared PostgreSQL vector store.');
    const vectors = driver === 'postgres' ? persistentVectorsFromEnv() : new MemoryVectorAdapter();
    if (vectors instanceof PostgresVectorAdapter) await vectors.init();
    const runtime = mode === 'bullmq' ? await createIngestionRuntime(vectors as PostgresVectorAdapter) : undefined;
    const clients: Redis[] = [];
    const connect = async (url: string) => {
        const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false, commandTimeout: 2000 });
        client.on('error', () => {}); await client.connect(); await client.ping(); clients.push(client); return client;
    };
    const redis = process.env.REDIS_URL ? await connect(process.env.REDIS_URL) : undefined;
    const nonceClient = process.env.CONFIRMATION_REDIS_URL ? await connect(process.env.CONFIRMATION_REDIS_URL) : redis;
    const engine = new RAGEngine({
        llmProvider: TieredLLMProvider.createFromEnv(),
        confirmation: { nonceStore: nonceClient ? new RedisConfirmationNonceStore(nonceClient) : undefined },
        ingestion: { backend: runtime?.backend },
        smlConfig: { enabled: false },
        inputs: {
            vectorStore: vectors,
            rules: new StaticRulesAdapter(['Answer accurately and politely using the supplied sources.', 'Never ask for credit card numbers or passwords.']),
            faq: process.env.FAQ_FILE_PATH ? new LocalFaqAdapter({ filePath: process.env.FAQ_FILE_PATH, defaultMatchThreshold: 0.80 }) : undefined
        },
        retrieval: { strategy: 'hybrid', topK: 3 },
        security: { enabled: true, blockHighRiskInjections: true, maxInputLength: 4000 },
        cache: { enabled: true, ...(redis ? { adapter: new RedisCacheAdapter({ client: redis, keyPrefix: process.env.CACHE_KEY_PREFIX || `rag:cache:${process.env.VECTOR_TABLE_NAME || 'rag_documents'}:` }) } : { filePath: './data/query-cache.json' }) }
    });
    const app = express();
    app.use(express.json({ limit: Math.ceil(positiveEnv('INGESTION_MAX_UPLOAD_BYTES', 5 * 1024 * 1024) * 4 / 3) + 65536 }));
    app.use('/api', createApiRoutes(engine, {
        auth: { allowDevAnonymous: process.env.ALLOW_ANONYMOUS_DEV_AUTH === 'true' },
        rateLimiter: redis ? createTenantRateLimiter(redis, { limit: positiveEnv('API_RATE_LIMIT', 120), windowMs: 60000, prefix: process.env.API_RATE_KEY_PREFIX || `rag:rate:${process.env.VECTOR_TABLE_NAME || 'rag_documents'}:` }) : undefined
    }));
    const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
        res.status(error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500)
            .json({ error: error.type === 'entity.too.large' ? 'Upload exceeds HTTP body limit.' : 'Request could not be processed.' });
    };
    app.use(handleError);
    const port = Number(process.env.PORT) || ENGINE_DEFAULTS.SERVER.PORT;
    const host = process.env.HOST || ENGINE_DEFAULTS.SERVER.HOST;
    const server = app.listen(port, host, () => console.log(`[RAG API] Ready on http://${host}:${port}; ingestion=${mode}`));
    let stopping = false;
    const stop = async () => {
        if (stopping) return; stopping = true;
        const deadline = setTimeout(() => { console.error('[RAG API] Shutdown timed out'); process.exit(1); }, positiveEnv('SHUTDOWN_TIMEOUT_MS', 30000));
        deadline.unref();
        try {
            await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
            await runtime?.close();
            for (const client of clients) client.disconnect();
            if (vectors instanceof PostgresVectorAdapter) await vectors.close();
        } catch (error) { console.error('[RAG API] Shutdown failed', error); process.exitCode = 1; }
        finally { clearTimeout(deadline); }
    };
    process.once('SIGTERM', () => { void stop(); }); process.once('SIGINT', () => { void stop(); });
}
bootstrap().catch(error => { console.error('[Server Startup Error]', error.message); process.exit(1); });
