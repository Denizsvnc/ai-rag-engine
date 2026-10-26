import crypto from 'crypto';
import { resolveSecret } from '../core/security/secrets';
import { z } from 'zod';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

export interface AuthTokenPayload {
    userId: string;
    tenantId: string;
    roles: string[];
    metadata?: Record<string, any> | undefined;
    iss?: string | undefined;
    aud?: string | undefined;
    nbf?: number | undefined;
    iat?: number | undefined;
    exp?: number | undefined;
}

export interface AuthMiddlewareOptions {
    jwtSecret?: string | undefined;
    issuer?: string | undefined;
    audience?: string | undefined;
    apiKeys?: Record<string, AuthTokenPayload> | undefined;
    allowDevAnonymous?: boolean | undefined;
}

declare global {
    namespace Express {
        interface Request {
            auth?: AuthTokenPayload | undefined;
        }
    }
}

const identitySchema = z.object({
    userId: z.string().min(1).refine(value => value.trim().length > 0),
    tenantId: z.string().min(1).refine(value => value.trim().length > 0),
    roles: z.array(z.string().min(1)),
    metadata: z.record(z.string(), z.unknown()).optional()
});
const tokenSchema = identitySchema.extend({
    iss: z.string().min(1), aud: z.string().min(1),
    iat: z.number().int(), exp: z.number().int(), nbf: z.number().int().optional()
});

function base64UrlEncode(str: string): string {
    return Buffer.from(str)
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
        base64 += '=';
    }
    return Buffer.from(base64, 'base64').toString('utf-8');
}

/**
 * Creates a cryptographically signed HMAC-SHA256 JWT token using native Node.js crypto.
 * Zero external dependencies.
 */
export function createAuthToken(
    payload: Omit<AuthTokenPayload, 'iat'>,
    secret: string = resolveSecret('JWT_SECRET'),
    expiresInSeconds: number = 86400
): string {
    secret = resolveSecret('JWT_SECRET', secret);
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const fullPayload: AuthTokenPayload = {
        ...payload,
        iss: payload.iss ?? process.env.JWT_ISSUER ?? 'ai-rag-engine',
        aud: payload.aud ?? process.env.JWT_AUDIENCE ?? 'ai-rag-engine-api',
        iat: now,
        exp: payload.exp ?? now + expiresInSeconds
    };

    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
    const signature = crypto
        .createHmac('sha256', secret)
        .update(`${encodedHeader}.${encodedPayload}`)
        .digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

    return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Verifies and decodes an HMAC-SHA256 JWT token using native Node.js crypto.
 */
export function verifyAuthToken(
    token: string,
    secret: string = resolveSecret('JWT_SECRET'),
    options: { issuer?: string | undefined; audience?: string | undefined } = {}
): AuthTokenPayload {
    secret = resolveSecret('JWT_SECRET', secret);
    const parts = token.split('.');
    if (parts.length !== 3) {
        throw new Error('Malformed JWT token structure.');
    }

    const [encodedHeader, encodedPayload, signature] = parts;
    if (!parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) throw new Error('Malformed JWT token structure.');
    const header = JSON.parse(base64UrlDecode(encodedHeader!));
    if (header.alg !== 'HS256' || header.typ !== 'JWT' || header.crit !== undefined) {
        throw new Error('Unsupported JWT header.');
    }
    const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(`${encodedHeader}.${encodedPayload}`)
        .digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

    const sigBuf = Buffer.from(signature as string);
    const expectedBuf = Buffer.from(expectedSignature);

    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
        throw new Error('Invalid token signature.');
    }

    const payload = tokenSchema.parse(JSON.parse(base64UrlDecode(encodedPayload as string)));
    const now = Math.floor(Date.now() / 1000);

    if (payload.exp <= now) {
        throw new Error('Token has expired.');
    }

    if (payload.iat > now || (payload.nbf !== undefined && payload.nbf > now) || payload.exp <= payload.iat) {
        throw new Error('Invalid token lifetime.');
    }
    if (payload.iss !== (options.issuer ?? process.env.JWT_ISSUER ?? 'ai-rag-engine') ||
        payload.aud !== (options.audience ?? process.env.JWT_AUDIENCE ?? 'ai-rag-engine-api')) {
        throw new Error('Invalid token issuer or audience.');
    }
    return payload;
}

/**
 * Express middleware that enforces trusted server-side authentication.
 * Prevents client-controlled role spoofing (P0 security barrier).
 */
export function createAuthMiddleware(options: AuthMiddlewareOptions): RequestHandler {
    const secret = resolveSecret('JWT_SECRET', options.jwtSecret);
    const allowDevAnonymous = options.allowDevAnonymous === true;
    if (process.env.NODE_ENV === 'production' && allowDevAnonymous) {
        throw new Error('Anonymous development authentication is forbidden in production.');
    }
    const apiKeys = options.apiKeys || {};

    return (req: Request, res: Response, next: NextFunction) => {
        const authHeader = req.headers['authorization'];
        const apiKeyHeader = req.headers['x-api-key'] as string | undefined;

        // 1. API Key Authentication
        if (apiKeyHeader && Object.hasOwn(apiKeys, apiKeyHeader)) {
            const identity = identitySchema.safeParse(apiKeys[apiKeyHeader]);
            if (!identity.success) {
                res.status(401).json({ error: 'Invalid API key identity.' });
                return;
            }
            req.auth = identity.data;
            return next();
        }

        // 2. Bearer JWT Authentication
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7).trim();
            try {
                req.auth = verifyAuthToken(token, secret, options);
                return next();
            } catch (err: any) {
                res.status(401).json({ error: `Authentication failed: ${err.message}` });
                return;
            }
        }

        // 3. Fallback for Local Development & Automated Tests (if explicitly allowed)
        if (allowDevAnonymous && !authHeader && !apiKeyHeader) {
            // Explicit local development mode accepts unverified headers.
            const devRoles = (req.headers['x-roles'] as string)?.split(',').map(r => r.trim());
            req.auth = {
                userId: (req.headers['x-user-id'] as string) || 'dev-user',
                tenantId: (req.headers['x-tenant-id'] as string) || 'default',
                roles: devRoles || ['guest']
            };
            return next();
        }

        // In Production: Missing or invalid token is strictly rejected
        res.status(401).json({
            error: 'Authentication required. Provide a valid Bearer token in Authorization header or x-api-key.'
        });
    };
}

/**
 * Route-level RBAC Guard: Ensures the authenticated user possesses at least one of the required roles.
 */
export function requireRoles(requiredRoles: string[]): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.auth) {
            res.status(401).json({ error: 'Authentication required.' });
            return;
        }

        const userRoles = req.auth.roles || [];
        const hasPermission = requiredRoles.some(role => userRoles.includes(role));

        if (!hasPermission) {
            res.status(403).json({
                error: `Access denied. Required role(s): [${requiredRoles.join(', ')}]. Caller has: [${userRoles.join(', ')}]`
            });
            return;
        }

        next();
    };
}
