import { Router } from 'express';
import { RAGEngine } from '../core/engine';
import { createRagMiddleware } from './middleware';
import { PrometheusExporter } from '../core/metrics/prometheus-exporter';

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

    // FinOps Token usage, cost savings, and latency metrics (supports ?format=prometheus)
    router.get('/metrics', (req, res) => {
        if (req.query.format === 'prometheus') {
            res.setHeader('Content-Type', 'text/plain; version=0.0.4');
            res.send(PrometheusExporter.exportMetrics(engine.getMetrics(), {
                activeCacheSize: engine.getCacheManager().size()
            }));
            return;
        }
        res.json(engine.getMetrics());
    });

    // Governed Tool Execution Audit Trail
    router.get('/audit', (req, res) => {
        res.json(engine.getAuditLogs());
    });

    // Asynchronous Document Ingestion endpoint
    router.post('/ingest', async (req, res) => {
        try {
            const { filename, content, mimeType } = req.body || {};
            if (!filename || !content) {
                res.status(400).json({
                    error: "Missing required fields: 'filename' and 'content' are required for document ingestion."
                });
                return;
            }

            const result = await engine.ingestDocument({ filename, content, mimeType });
            res.status(202).json({
                message: 'Document accepted for asynchronous ingestion and PII sanitization.',
                ...result
            });
        } catch (error: any) {
            res.status(400).json({ error: error.message || 'Failed to submit document for ingestion.' });
        }
    });

    // Ingestion Job Status polling endpoint
    router.get('/ingest/status/:jobId', async (req, res) => {
        try {
            const job = await engine.getIngestionStatus(req.params.jobId!);
            if (!job) {
                res.status(404).json({ error: `Ingestion job '${req.params.jobId}' not found.` });
                return;
            }
            res.json(job);
        } catch (error: any) {
            res.status(500).json({ error: error.message || 'Failed to retrieve job status.' });
        }
    });

    return router;
}