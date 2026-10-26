import fs from 'fs/promises';
import path from 'path';
import type { IAgentTool } from '../interfaces/tool.interface';
import { SMLEngine } from './sml-engine';

interface RegistrySchema {
    version: string;
    tools: Array<{
        name: string;
        description: string;
        embedding: number[];
    }>;
}

export class ToolRegistry {
    private activeTools: Map<string, IAgentTool> = new Map();
    private toolEmbeddings: Array<{ id: string; embedding: number[] }> = [];

    constructor(
        private smlEngine: SMLEngine,
        private registryPath: string = './data/tools-registry.json'
    ) { }

    public async initialize(tools: IAgentTool[]): Promise<void> {
        await fs.mkdir(path.dirname(this.registryPath), { recursive: true });

        let existingRegistry: RegistrySchema = { version: '1.0.0', tools: [] };
        try {
            const fileData = await fs.readFile(this.registryPath, 'utf-8');
            existingRegistry = JSON.parse(fileData);
        } catch (error: any) {
            if (error.code !== 'ENOENT') console.error('[ToolRegistry] Registry dosyası okunamadı:', error);
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
            'utf-8'
        );
    }

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

    public getTool(name: string): IAgentTool | undefined {
        return this.activeTools.get(name);
    }

    public getAllTools(): IAgentTool[] {
        return Array.from(this.activeTools.values());
    }

    /**
     * Routes a user query to the most semantically relevant tool.
     */
    public async routeQueryToTool(query: string, threshold: number = 0.65): Promise<IAgentTool | null> {
        const match = await this.smlEngine.findBestMatch(query, this.toolEmbeddings, threshold);
        if (match) {
            return this.activeTools.get(match.target.id) || null;
        }
        return null;
    }
}