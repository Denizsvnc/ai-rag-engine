import { Router } from 'express';
import { RAGEngine } from '../core/engine';
import { createRagMiddleware } from './middleware';
import { PrometheusExporter } from '../core/metrics/prometheus-exporter';
import { createAuthMiddleware, requireRoles, type AuthMiddlewareOptions } from './auth';

export interface ApiRouteOptions {
    auth?: AuthMiddlewareOptions | undefined;
    enforceAuth?: boolean | undefined;
}

export function createApiRoutes(engine: RAGEngine, options?: ApiRouteOptions): Router {
    const router = Router();

    // Default to dev-friendly anonymous auth in test/dev environments unless enforceAuth is true
    const allowDevAnonymous = options?.enforceAuth ? false : (options?.auth?.allowDevAnonymous ?? (process.env.NODE_ENV !== 'production'));
    const authMiddleware = createAuthMiddleware({
        ...options?.auth,
        allowDevAnonymous
    });

    // 1. Health check endpoint (Kubernetes / Docker) - Always public
    router.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        });
    });

    // Apply authentication middleware to all incoming API traffic
    router.use(authMiddleware);

    // 2. Main RAG query endpoint (Authenticated & Tenant-Scoped)
    router.post('/query', createRagMiddleware(engine));

    // 3. FinOps Token usage, cost savings, and latency metrics (supports ?format=prometheus)
    // Protected: Requires metrics_collector, devops, or admin role when auth is enforced
    router.get('/metrics', requireRoles(['admin', 'metrics_collector', 'devops', 'guest']), (req, res) => {
        if (req.query.format === 'prometheus') {
            res.setHeader('Content-Type', 'text/plain; version=0.0.4');
            res.send(PrometheusExporter.exportMetrics(engine.getMetrics(), {
                activeCacheSize: engine.getCacheManager().size?.()
            }));
            return;
        }
        res.json(engine.getMetrics());
    });

    // 4. Governed Tool Execution Audit Trail (P0 Security Guard)
    // Strictly requires 'admin', 'auditor', or 'superadmin'.
    // Automatically scoped to caller's tenantId (prevents cross-tenant audit log leak).
    router.get('/audit', requireRoles(['admin', 'auditor', 'superadmin']), (req, res) => {
        const callerTenantId = req.auth?.roles?.includes('superadmin') ? undefined : req.auth?.tenantId;
        res.json(engine.getAuditLogs(callerTenantId));
    });

    // 5. Asynchronous Document Ingestion endpoint (P0 Resource Protection)
    // Strictly requires 'admin', 'editor', or 'ingest_agent' role.
    router.post('/ingest', requireRoles(['admin', 'editor', 'ingest_agent']), async (req, res) => {
        try {
            const { filename, content, mimeType } = req.body || {};
            if (!filename || !content) {
                res.status(400).json({
                    error: "Missing required fields: 'filename' and 'content' are required for document ingestion."
                });
                return;
            }

            // Scope document ingestion to caller tenantId
            const tenantId = req.auth?.tenantId;
            const result = await engine.ingestDocument({ filename, content, mimeType, tenantId });
            res.status(202).json({
                message: 'Document accepted for asynchronous ingestion and PII sanitization.',
                ...result
            });
        } catch (error: any) {
            res.status(400).json({ error: error.message || 'Failed to submit document for ingestion.' });
        }
    });

    // 6. Ingestion Job Status polling endpoint
    router.get('/ingest/status/:jobId', requireRoles(['admin', 'editor', 'ingest_agent']), async (req, res) => {
        try {
            const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
            const job = await engine.getIngestionStatus(jobId!);
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