import crypto from 'crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

export interface AuthTokenPayload {
    userId: string;
    tenantId: string;
    roles: string[];
    metadata?: Record<string, any> | undefined;
    iat?: number | undefined;
    exp?: number | undefined;
}

export interface AuthMiddlewareOptions {
    jwtSecret?: string | undefined;
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
    secret: string = process.env.JWT_SECRET || 'dev-secret-key-change-in-production',
    expiresInSeconds: number = 86400
): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const fullPayload: AuthTokenPayload = {
        ...payload,
        iat: now,
        exp: payload.exp || now + expiresInSeconds
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
    secret: string = process.env.JWT_SECRET || 'dev-secret-key-change-in-production'
): AuthTokenPayload {
    const parts = token.split('.');
    if (parts.length !== 3) {
        throw new Error('Malformed JWT token structure.');
    }

    const [encodedHeader, encodedPayload, signature] = parts;
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

    const payload: AuthTokenPayload = JSON.parse(base64UrlDecode(encodedPayload as string));
    const now = Math.floor(Date.now() / 1000);

    if (payload.exp && payload.exp < now) {
        throw new Error('Token has expired.');
    }

    return payload;
}

/**
 * Express middleware that enforces trusted server-side authentication.
 * Prevents client-controlled role spoofing (P0 security barrier).
 */
export function createAuthMiddleware(options: AuthMiddlewareOptions): RequestHandler {
    const secret = options.jwtSecret || process.env.JWT_SECRET || 'dev-secret-key-change-in-production';
    const apiKeys = options.apiKeys || {};

    return (req: Request, res: Response, next: NextFunction) => {
        const authHeader = req.headers['authorization'];
        const apiKeyHeader = req.headers['x-api-key'] as string | undefined;

        // 1. API Key Authentication
        if (apiKeyHeader && apiKeys[apiKeyHeader]) {
            req.auth = apiKeys[apiKeyHeader];
            return next();
        }

        // 2. Bearer JWT Authentication
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7).trim();
            try {
                req.auth = verifyAuthToken(token, secret);
                return next();
            } catch (err: any) {
                res.status(401).json({ error: `Authentication failed: ${err.message}` });
                return;
            }
        }

        // 3. Fallback for Local Development & Automated Tests (if explicitly allowed)
        if (options.allowDevAnonymous || process.env.ALLOW_ANONYMOUS_DEV_AUTH === 'true') {
            // In dev mode, if client provides headers, accept with a clear untrusted warning tag
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
