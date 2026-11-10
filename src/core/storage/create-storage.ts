import type {
    StorageContainerConfig,
    StorageContainer,
    StorageCapabilities
} from '../../interfaces/storage.interface.js';
import { StorageCapabilityRegistry } from './storage-capability-registry.js';

function hasInit(target: unknown): target is { init: () => Promise<void> } {
    return Boolean(target && typeof target === 'object' && 'init' in target && typeof (target as { init?: unknown }).init === 'function');
}

function hasClose(target: unknown): target is { close: () => Promise<void> } {
    return Boolean(target && typeof target === 'object' && 'close' in target && typeof (target as { close?: unknown }).close === 'function');
}

function hasReady(target: unknown): target is { ready: () => Promise<void> } {
    return Boolean(target && typeof target === 'object' && 'ready' in target && typeof (target as { ready?: unknown }).ready === 'function');
}

/**
 * Creates a unified, capability-driven storage container for AI-RAG-ENGINE.
 *
 * @remarks
 * Orchestrates independent document, vector, graph, cache, ingestion, and blob stores.
 * Discovers and validates provider capabilities without coupling to concrete database engines.
 *
 * @param config - Independent storage adapter assignments.
 * @returns Fully orchestrated `StorageContainer` with lifecycle management.
 *
 * @example
 * ```typescript
 * import { createStorage, MemoryVectorAdapter, MemoryGraphAdapter } from '@denizsvnc/ai-rag-engine';
 *
 * const storage = createStorage({
 *   vectors: new MemoryVectorAdapter(),
 *   graph: new MemoryGraphAdapter()
 * });
 * await storage.init();
 * ```
 */
export function createStorage(config: StorageContainerConfig): StorageContainer & { registry: StorageCapabilityRegistry } {
    const registry = new StorageCapabilityRegistry();

    // Register all configured adapters with the capability registry
    if (config.vectors) {
        registry.register('vectors', config.vectors.constructor.name, config.vectors);
    }
    if (config.documents) {
        registry.register('documents', config.documents.constructor.name, config.documents);
    }
    if (config.graph) {
        registry.register('graph', config.graph.constructor.name, config.graph);
    }
    if (config.cache) {
        registry.register('cache', config.cache.constructor.name, config.cache);
    }
    if (config.ingestion) {
        registry.register('ingestion', config.ingestion.constructor.name, config.ingestion);
    }
    if (config.blob) {
        registry.register('blob', config.blob.constructor.name, config.blob);
    }

    return {
        config,
        registry,

        async init(): Promise<void> {
            const initTasks: Promise<void>[] = [];

            if (hasInit(config.vectors)) initTasks.push(config.vectors.init());
            if (hasInit(config.documents)) initTasks.push(config.documents.init());
            if (hasInit(config.graph)) initTasks.push(config.graph.init());
            if (hasInit(config.cache)) initTasks.push(config.cache.init());
            if (hasReady(config.ingestion)) initTasks.push(config.ingestion.ready());
            else if (hasInit(config.ingestion)) initTasks.push((config.ingestion as { init: () => Promise<void> }).init());
            if (hasInit(config.blob)) initTasks.push(config.blob.init());

            await Promise.all(initTasks);
        },

        async close(): Promise<void> {
            const closeTasks: Promise<void>[] = [];

            if (hasClose(config.vectors)) closeTasks.push(config.vectors.close());
            if (hasClose(config.documents)) closeTasks.push(config.documents.close());
            if (hasClose(config.graph)) closeTasks.push(config.graph.close());
            if (hasClose(config.cache)) closeTasks.push(config.cache.close());
            if (hasClose(config.ingestion)) closeTasks.push(config.ingestion.close());
            if (hasClose(config.blob)) closeTasks.push(config.blob.close());
            if (hasClose(config.queue)) closeTasks.push(config.queue.close());

            await Promise.allSettled(closeTasks);
        },

        async healthCheck(): Promise<Record<string, { status: 'healthy' | 'unhealthy'; latencyMs?: number; error?: string }>> {
            const report: Record<string, { status: 'healthy' | 'unhealthy'; latencyMs?: number; error?: string }> = {};

            const checkTarget = async (role: string, target: unknown) => {
                if (!target) return;
                const t0 = Date.now();
                try {
                    if (hasReady(target)) await target.ready();
                    else if (hasInit(target)) await target.init();
                    report[role] = { status: 'healthy', latencyMs: Date.now() - t0 };
                } catch (e: unknown) {
                    report[role] = {
                        status: 'unhealthy',
                        latencyMs: Date.now() - t0,
                        error: e instanceof Error ? e.message : String(e)
                    };
                }
            };

            await Promise.all([
                checkTarget('vectors', config.vectors),
                checkTarget('documents', config.documents),
                checkTarget('graph', config.graph),
                checkTarget('cache', config.cache),
                checkTarget('ingestion', config.ingestion),
                checkTarget('blob', config.blob)
            ]);

            return report;
        },

        validateCapabilities(requirements: Partial<Record<keyof StorageContainerConfig, Array<keyof StorageCapabilities>>>): boolean {
            for (const [role, caps] of Object.entries(requirements)) {
                if (!caps) continue;
                for (const cap of caps) {
                    if (!registry.hasCapability(role, cap)) return false;
                }
            }
            return true;
        }
    };
}
