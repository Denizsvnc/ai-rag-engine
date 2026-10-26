import type { Request, Response, NextFunction } from 'express';
import { RAGEngine } from '../core/engine';
import type { QueryContext } from '../interfaces/query-context.interface';

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
        } catch (error: any) {
            console.error('[RAG Middleware] İşlem hatası:', error);
            res.status(500).json({ error: error.message || 'Sunucu içi hata oluştu.' });
        }
    };
}