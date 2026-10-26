import 'dotenv/config';
import express from 'express';
import {
    RAGEngine,
    createRagMiddleware,
    OpenAIAdapter,
    OllamaAdapter,
    type IAgentTool,
    type IRulesAdapter
} from '../../index';

const app = express();
app.use(express.json());

// 1. Mock Business Rules Adapter
class MockRulesAdapter implements IRulesAdapter {
    async getActiveRules(tenantId?: string): Promise<string[]> {
        return [
            'Always maintain a polite and professional tone.',
            'Decline requests for installment or delayed payments.',
            'The return window for all items is 14 days.'
        ];
    }
}

// 2. Live Database Tool (SML routes queries based on this description)
const checkStockTool: IAgentTool<{ productName: string }> = {
    name: 'check_live_stock',
    description: 'Retrieves current warehouse stock count and price for a product from the database.',
    parameters: {
        type: 'object',
        properties: {
            productName: { type: 'string', description: 'Name of the product to query stock for' }
        },
        required: ['productName']
    },
    execute: async ({ productName }: { productName: string }) => {
        console.log(`[DB] Querying database for "${productName}"...`);
        // Mock database response
        if (productName.toLowerCase().includes('laptop')) {
            return { stock: 12, price: '$1200', location: 'Warehouse A' };
        }
        return { stock: 0, status: 'Out of stock' };
    }
};

// 3. Configure the RAG Engine (with graceful provider fallback)
const apiKey = process.env.OPENAI_API_KEY;
const provider = apiKey
    ? new OpenAIAdapter(apiKey, 'gpt-4o-mini')
    : new OllamaAdapter({ model: process.env.OLLAMA_MODEL_FAST || 'llama3.2:3b' });

const ragEngine = new RAGEngine({
    llmProvider: provider,
    inputs: {
        rules: new MockRulesAdapter()
    },
    tools: {
        registryFilePath: './data/tools-registry.json',
        items: [checkStockTool]
    },
    cache: {
        enabled: true,
        filePath: './data/cache.json'
    }
});

// 4. Attach middleware to Express route
app.use('/api/chat', createRagMiddleware(ragEngine));

app.listen(3000, () => {
    console.log('E-Ticaret Agentic RAG Sunucusu 3000 portunda çalışıyor.');
    console.log('Test için POST /api/chat {"query": "Laptop stokta var mı, ayrıca veresiye alabilir miyim?"} isteği atın.');
});