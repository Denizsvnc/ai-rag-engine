import fs from 'fs/promises';
import path from 'path';
import type { IAgentTool } from '../interfaces/tool.interface.js';
import { SMLEngine } from './sml-engine.js';

interface RegistrySchema {
    version: string;
    tools: Array<{
        name: string;
        description: string;
        embedding: number[];
    }>;
}

/**
 * Registry and semantic router for governed agent tools.
 *
 * @remarks
 * Precomputes and caches description embeddings using `SMLEngine` to route user intents
 * to tools with sub-millisecond local vector matching, without LLM roundtrips.
 *
 * @example
 * ```typescript
 * const registry = new ToolRegistry(smlEngine, './data/tools.json');
 * await registry.initialize([weatherTool, stockTool]);
 * const matched = await registry.routeQueryToTool('Will it rain tomorrow in Istanbul?');
 * ```
 */
export class ToolRegistry {
    private activeTools: Map<string, IAgentTool> = new Map();
    private toolEmbeddings: Array<{ id: string; embedding: number[] }> = [];

    /**
     * Creates a new `ToolRegistry`.
     *
     * @param smlEngine - Active Small Machine Learning engine for embedding generation.
     * @param registryPath - File path to cache tool embeddings on disk. Defaults to `'./data/tools-registry.json'`.
     */
    constructor(
        private smlEngine: SMLEngine,
        private registryPath: string = './data/tools-registry.json'
    ) { }

    /**
     * Initializes the registry with an array of tools, reusing cached embeddings where descriptions match.
     *
     * @param tools - Array of agent tools conforming to `IAgentTool`.
     */
    public async initialize(tools: IAgentTool[]): Promise<void> {
        await fs.mkdir(path.dirname(this.registryPath), { recursive: true });

        let existingRegistry: RegistrySchema = { version: '1.0.0', tools: [] };
        try {
            const fileData = await fs.readFile(this.registryPath, 'utf-8');
            existingRegistry = JSON.parse(fileData);
        } catch (error: unknown) {
            const errCode = (error as { code?: string })?.code;
            if (errCode !== 'ENOENT') console.error('[ToolRegistry] Registry dosyası okunamadı:', error);
        }

        const updatedRegistryTools: RegistrySchema['tools'] = [];

        for (const tool of tools) {
            this.activeTools.set(tool.name, tool);

            // Reuse cached embedding if description has not changed
            const cachedItem = existingRegistry.tools.find(t => t.name === tool.name);

            let embedding: number[];
            if (cachedItem && cachedItem.description === tool.description) {
                embedding = cachedItem.embedding;
            } else {
                console.log(`[ToolRegistry] Generating embedding for tool: ${tool.name}`);
                const rawEmbedding = await this.smlEngine.getEmbedding(tool.description);
                embedding = Array.from(rawEmbedding);
            }

            updatedRegistryTools.push({
                name: tool.name,
                description: tool.description,
                embedding
            });

            this.toolEmbeddings.push({ id: tool.name, embedding });
        }

        // Persist updated tool metadata and embeddings to JSON
        await fs.writeFile(
            this.registryPath,
            JSON.stringify({ version: '1.0.0', tools: updatedRegistryTools }, null, 2),
            { encoding: 'utf-8', mode: 0o600 }
        );
    }

    /**
     * Registers a single agent tool dynamically and computes its description embedding.
     *
     * @param tool - The agent tool definition to register.
     */
    public async registerTool(tool: IAgentTool): Promise<void> {
        this.activeTools.set(tool.name, tool);
        try {
            const rawEmbedding = await this.smlEngine.getEmbedding(tool.description);
            const embedding = Array.from(rawEmbedding);
            this.toolEmbeddings.push({ id: tool.name, embedding });
        } catch {
            this.toolEmbeddings.push({ id: tool.name, embedding: [] });
        }
    }

    /**
     * Retrieves an active tool by its unique name.
     *
     * @param name - The tool name.
     * @returns The `IAgentTool` if found, or `undefined`.
     */
    public getTool(name: string): IAgentTool | undefined {
        return this.activeTools.get(name);
    }

    /**
     * Retrieves all registered agent tools.
     *
     * @returns Array of registered `IAgentTool` instances.
     */
    public getAllTools(): IAgentTool[] {
        return Array.from(this.activeTools.values());
    }

    /**
     * Routes a user query to the most semantically relevant tool based on description cosine similarity.
     *
     * @param query - The user question or instruction.
     * @param threshold - Minimum cosine similarity required to trigger a tool match. Defaults to 0.65.
     * @returns The matching `IAgentTool` or `null` if no tool exceeds the threshold.
     */
    public async routeQueryToTool(query: string, threshold: number = 0.65): Promise<IAgentTool | null> {
        const match = await this.smlEngine.findBestMatch(query, this.toolEmbeddings, threshold);
        if (match) {
            return this.activeTools.get(match.target.id) || null;
        }
        return null;
    }
}