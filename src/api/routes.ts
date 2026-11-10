import { Router, type RequestHandler } from 'express';
import { IngestionConflictError, IngestionQuotaError } from '../core/ingestion/postgres-ingestion-store.js';
import { RAGEngine } from '../core/engine.js';
import { createRagMiddleware } from './middleware.js';
import { PrometheusExporter } from '../core/metrics/prometheus-exporter.js';
import { createAuthMiddleware, requireRoles, type AuthMiddlewareOptions } from './auth.js';

/**
 * Configuration options for Express API route generation.
 */
export interface ApiRouteOptions {
    /** Optional rate limiter middleware to apply across routes. */
    rateLimiter?: RequestHandler | undefined;
    /** Authentication middleware options. */
    auth?: AuthMiddlewareOptions | undefined;
    /** Whether authentication is strictly required even in non-production environments. */
    enforceAuth?: boolean | undefined;
}

/**
 * Creates an Express router exposing all AI-RAG-ENGINE endpoints.
 *
 * @remarks
 * Sets up routes for `/health`, `/query`, `/metrics`, `/audit`, `/ingest`, and `/ingest/status/:jobId`.
 * Enforces role-based access control (RBAC), tenant isolation, and Prometheus telemetry exports.
 *
 * @param engine - Configured {@link RAGEngine} instance.
 * @param options - API route and security options.
 * @returns Fully configured Express Router.
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { RAGEngine, createApiRoutes } from '@denizsvnc/ai-rag-engine';
 *
 * const app = express();
 * const engine = new RAGEngine(config);
 *
 * app.use('/api', createApiRoutes(engine, {
 *   enforceAuth: true
 * }));
 * ```
 */
export function createApiRoutes(engine: RAGEngine, options?: ApiRouteOptions): Router {
    const router = Router();

    // Anonymous development access requires explicit opt-in and is forbidden in production.
    const allowDevAnonymous = options?.enforceAuth ? false : (options?.auth?.allowDevAnonymous === true);
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
    if (options?.rateLimiter) router.use(options.rateLimiter);

    // 2. Main RAG query endpoint (Authenticated & Tenant-Scoped)
    router.post('/query', createRagMiddleware(engine));

    // 3. FinOps Token usage, cost savings, and latency metrics (supports ?format=prometheus)
    // Protected: Requires metrics_collector, devops, or admin role when auth is enforced
    router.get('/metrics', requireRoles(['admin', 'metrics_collector', 'devops']), (req, res) => {
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
            const { filename, content, mimeType, documentId, encoding } = req.body || {};
            if (!filename || !content) {
                res.status(400).json({
                    error: "Missing required fields: 'filename' and 'content' are required for document ingestion."
                });
                return;
            }

            // Scope document ingestion to caller tenantId
            const tenantId = req.auth?.tenantId;
            const result = await engine.ingestDocument({ filename, content, mimeType, documentId, encoding, idempotencyKey: typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined, tenantId, userId: req.auth!.userId });
            res.status(202).json({
                message: 'Document accepted for asynchronous ingestion and PII sanitization.',
                ...result
            });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Failed to submit document for ingestion.';
            res.status(error instanceof IngestionQuotaError ? 429 : error instanceof IngestionConflictError ? 409 : 400).json({ error: msg });
        }
    });

    // 6. Ingestion Job Status polling endpoint
    router.get('/ingest/status/:jobId', requireRoles(['admin', 'editor', 'ingest_agent']), async (req, res) => {
        try {
            const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
            const job = await engine.getIngestionStatus(jobId!, req.auth!.tenantId);
            if (!job) {
                res.status(404).json({ error: `Ingestion job '${req.params.jobId}' not found.` });
                return;
            }
            res.json({
                id: job.id, status: job.status, progress: job.progress,
                createdAt: job.createdAt, updatedAt: job.updatedAt, completedAt: job.completedAt, attemptsMade: job.attemptsMade,
                result: job.result, ...(job.error ? { error: 'Ingestion failed.' } : {})
            });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Failed to retrieve job status.';
            res.status(500).json({ error: msg });
        }
    });

    router.post('/ingest/status/:jobId/retry', requireRoles(['admin', 'editor', 'ingest_agent']), async (req, res) => {
        const jobId = String(req.params.jobId);
        try {
            if (!await engine.getIngestionStatus(jobId, req.auth!.tenantId)) { res.status(404).json({ error: 'Job not found.' }); return; }
            await engine.retryIngestion(jobId, req.auth!.tenantId);
            res.status(202).json({ jobId, status: 'queued' });
        } catch { res.status(409).json({ error: 'Job cannot be retried.' }); }
    });

    return router;
}