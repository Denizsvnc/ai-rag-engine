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

            // Extract multi-tenant metadata from enterprise HTTP headers or request body
            const tenantId = (req.headers['x-tenant-id'] as string) || bodyContext?.tenantId;
            const userId = (req.headers['x-user-id'] as string) || bodyContext?.userId;
            const rolesHeader = req.headers['x-roles'] as string;
            const roles = rolesHeader ? rolesHeader.split(',').map(r => r.trim()) : bodyContext?.roles;
            const confirmedAction = req.headers['x-confirmed-action'] === 'true' || bodyContext?.confirmedAction;

            const resolvedContext: QueryContext = {
                ...bodyContext,
                ...(tenantId ? { tenantId } : {}),
                ...(userId ? { userId } : {}),
                ...(roles ? { roles } : {}),
                ...(confirmedAction ? { confirmedAction } : {})
            };

            const result = await engine.query(query, resolvedContext);
            res.json(result);
        } catch (error: any) {
            console.error('[RAG Middleware] İşlem hatası:', error);
            res.status(500).json({ error: error.message || 'Sunucu içi hata oluştu.' });
        }
    };
}