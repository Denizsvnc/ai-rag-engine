import { RAGEngine, SMLEngine, PostgresVectorAdapter, IngestionWorker, QueuedIngestionService, createApiRoutes,
    type IVectorStoreAdapter, type ILLMProvider, type IAgentTool, type EngineConfig, type IIngestionBackend,
    type ConfirmationNonceStore, type QueryContext, type EngineMetricsSummary } from '@denizsvnc/ai-rag-engine';
const vectors: IVectorStoreAdapter = { async search() { return []; } };
const provider: ILLMProvider = { async generate() { return { content: 'typed' }; } };
const config: EngineConfig = { inputs: { vectorStore: vectors }, llmProvider: provider, smlConfig: { enabled: false } };
const engine = new RAGEngine(config);
const metrics: EngineMetricsSummary = engine.getMetrics();
const context: QueryContext = { tenantId: 'tenant-a', userId: 'user-a', roles: ['viewer'] };
const tool: IAgentTool<{ id: string }> = { name: 'lookup', description: 'Look up an item', parameters: { type: 'object', properties: { id: { type: 'string', description: 'Item ID' } } }, async execute(args) { return args.id; } };
const backend: IIngestionBackend | undefined = undefined;
const nonce: ConfirmationNonceStore | undefined = undefined;
void [SMLEngine, PostgresVectorAdapter, IngestionWorker, QueuedIngestionService, createApiRoutes, metrics, context, tool, backend, nonce];
