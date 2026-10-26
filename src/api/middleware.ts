import type { Request, Response, NextFunction } from 'express';
import { RAGEngine } from '../core/engine';

export function createRagMiddleware(engine: RAGEngine) {
    let isInitialized = false;

    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            if (!isInitialized) {
                await engine.init();
                isInitialized = true;
            }

            const { query, context } = req.body;

            if (!query || typeof query !== 'string') {
                return res.status(400).json({ error: '"query" alanı zorunludur ve string olmalıdır.' });
            }

            const result = await engine.query(query, context);
            res.json(result);
        } catch (error: any) {
            console.error('[RAG Middleware] İşlem hatası:', error);
            res.status(500).json({ error: error.message || 'Sunucu içi hata oluştu.' });
        }
    };
}