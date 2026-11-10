import type { Request, Response, NextFunction } from 'express';
import { RAGEngine } from '../core/engine.js';
import type { QueryContext } from '../interfaces/query-context.interface.js';

/**
 * Creates an Express middleware handler for query processing via {@link RAGEngine}.
 *
 * @remarks
 * Extracts query parameters from request body, enforces tenant authorization from `req.auth`,
 * extracts confirmation tickets from headers or body, and forwards requests to the RAG engine.
 *
 * @param engine - Initialized or pre-configured {@link RAGEngine} instance.
 * @returns Express route middleware handler function.
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { RAGEngine, createRagMiddleware } from '@denizsvnc/ai-rag-engine';
 *
 * const app = express();
 * const engine = new RAGEngine(config);
 *
 * app.post('/rag/query', createRagMiddleware(engine));
 * ```
 */
export function createRagMiddleware(engine: RAGEngine) {
    let isInitialized = false;

    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            if (!req.auth) return res.status(401).json({ error: 'Authentication required.' });
            if (!isInitialized) {
                await engine.init();
                isInitialized = true;
            }

            const { query, context: bodyContext } = req.body || {};

            if (!query || typeof query !== 'string') {
                return res.status(400).json({ error: '"query" alanı zorunludur ve string olmalıdır.' });
            }

            // Only authentication middleware may supply identity and authorization claims.
            const resolvedContext: QueryContext = {
                tenantId: req.auth.tenantId,
                userId: req.auth.userId,
                roles: req.auth.roles,
                metadata: req.auth.metadata,
                skipCache: bodyContext?.skipCache === true,
                confirmationTicket: typeof req.headers['x-confirmation-ticket'] === 'string'
                    ? req.headers['x-confirmation-ticket']
                    : typeof bodyContext?.confirmationTicket === 'string' ? bodyContext.confirmationTicket : undefined
            };

            const result = await engine.query(query, resolvedContext);
            res.json(result);
        } catch (error: unknown) {
            console.error('[RAG Middleware] İşlem hatası:', error);
            const msg = error instanceof Error ? error.message : 'Sunucu içi hata oluştu.';
            res.status(500).json({ error: msg });
        }
    };
}