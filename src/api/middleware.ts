import type { Request, Response, NextFunction } from 'express';
import { RAGEngine } from '../core/engine';
import type { QueryContext } from '../interfaces/query-context.interface';

export function createRagMiddleware(engine: RAGEngine) {
    let isInitialized = false;

    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            if (!isInitialized) {
                await engine.init();
                isInitialized = true;
            }

            const { query, context: bodyContext } = req.body || {};

            if (!query || typeof query !== 'string') {
                return res.status(400).json({ error: '"query" alanı zorunludur ve string olmalıdır.' });
            }

            // Prioritize server-verified auth claims (P0 Security) over raw client headers
            const auth = req.auth;
            const tenantId = auth?.tenantId || (req.headers['x-tenant-id'] as string) || bodyContext?.tenantId;
            const userId = auth?.userId || (req.headers['x-user-id'] as string) || bodyContext?.userId;
            const roles = auth?.roles || (req.headers['x-roles'] ? (req.headers['x-roles'] as string).split(',').map(r => r.trim()) : bodyContext?.roles);
            const confirmedAction = req.headers['x-confirmed-action'] === 'true' || bodyContext?.confirmedAction;
            const confirmationTicket = (req.headers['x-confirmation-ticket'] as string) || bodyContext?.confirmationTicket;

            const resolvedContext: QueryContext = {
                ...bodyContext,
                ...(tenantId ? { tenantId } : {}),
                ...(userId ? { userId } : {}),
                ...(roles ? { roles } : {}),
                ...(confirmedAction ? { confirmedAction } : {}),
                ...(confirmationTicket ? { confirmationTicket } : {})
            };

            const result = await engine.query(query, resolvedContext);
            res.json(result);
        } catch (error: any) {
            console.error('[RAG Middleware] İşlem hatası:', error);
            res.status(500).json({ error: error.message || 'Sunucu içi hata oluştu.' });
        }
    };
}