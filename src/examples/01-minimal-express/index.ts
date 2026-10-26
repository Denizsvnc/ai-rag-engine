import 'dotenv/config';
import express from 'express';
import { RAGEngine, createRagMiddleware, OpenAIAdapter, OllamaAdapter } from '../../index';

const app = express();
app.use(express.json());

// 1. Initialize engine with configured provider (OpenAI if key present, otherwise Ollama or mock)
const apiKey = process.env.OPENAI_API_KEY;
const provider = apiKey
    ? new OpenAIAdapter(apiKey)
    : new OllamaAdapter({ model: process.env.OLLAMA_MODEL_FAST || 'llama3.2:3b' });

const ragEngine = new RAGEngine({
    llmProvider: provider,
    inputs: {}
});

// 2. Attach middleware to Express route
app.post('/ask', createRagMiddleware(ragEngine));

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
    console.log(`Minimal RAG Engine is running on port ${PORT}.`);
    console.log(`To test: curl -X POST http://localhost:${PORT}/ask -H "Content-Type: application/json" -d '{"query": "Merhaba, nasılsın?"}'`);
});