import express from 'express';
import { RAGEngine, createRagMiddleware, OpenAIAdapter } from '../../index';

const app = express();
app.use(express.json());

// 1. Initialize engine with minimal configuration
// SML intent routing and in-memory LRU cache use default settings automatically.
const ragEngine = new RAGEngine({
    llmProvider: new OpenAIAdapter(process.env.OPENAI_API_KEY),
    inputs: {}
});

// 2. Attach middleware to Express route
app.post('/ask', createRagMiddleware(ragEngine));

app.listen(3000, () => {
    console.log('Minimal RAG Engine is running on port 3000.');
    console.log('To test: curl -X POST http://localhost:3000/ask -H "Content-Type: application/json" -d \'{"query": "Merhaba, nasılsın?"}\'');
});