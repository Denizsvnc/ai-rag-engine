import { Router } from 'express';
import { RAGEngine } from '../core/engine';
import { createRagMiddleware } from './middleware';

export function createApiRoutes(engine: RAGEngine): Router {
    const router = Router();

    // Main RAG query endpoint
    router.post('/query', createRagMiddleware(engine));

    // Health check endpoint (Kubernetes / Docker)
    router.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        });
    });

    return router;
}