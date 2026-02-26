/**
 * Authentication Middleware
 *
 * Protects routes by requiring valid authentication.
 * Supports Bearer token (OAuth) authentication.
 */

import { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        name: string;
      };
    }
  }
}

function sendAuthRequired(req: Request, res: Response): void {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const readinessStatus = global.serverReadiness?.getStatus();
  const isStarting = readinessStatus?.state === 'starting';

  const message = isStarting
    ? 'Server is starting up - authentication tokens loading from database. Please retry in 2-3 seconds.'
    : 'Connection reset after server restart. Your authentication is safe, just reconnect by restarting Claude Code.';

  const instructions = isStarting
    ? 'Server is loading authentication state. This takes 1-3 seconds. Please retry your connection.'
    : 'Server was restarted. Your authentication tokens are safe. Restart Claude Code to establish a fresh connection.';

  res.status(401).json({
    jsonrpc: '2.0',
    error: {
      code: -32001,
      message,
      data: {
        readiness: readinessStatus,
        authentication: {
          type: 'oauth2',
          oauth_authorization_server: `${baseUrl}/.well-known/oauth-authorization-server`,
          authorization_endpoint: `${baseUrl}/authorize`,
          token_endpoint: `${baseUrl}/token`,
          registration_endpoint: `${baseUrl}/register`,
          instructions,
        },
      },
    },
    id: null,
  });
}

function checkAuth(req: Request): { userId: string; email: string; name: string } | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    if (global.accessTokenStore) {
      const tokenData = global.accessTokenStore.validate(token);
      if (tokenData) {
        return {
          userId: tokenData.userId,
          email: tokenData.email,
          name: tokenData.name,
        };
      }
    }
  }
  return null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const user = checkAuth(req);
  if (user) {
    req.user = user;
    return next();
  }
  sendAuthRequired(req, res);
}

export function requireAuthForToolCall(req: Request, res: Response, next: NextFunction): void {
  if (process.env.REQUIRE_AUTH === 'false') {
    return next();
  }

  const user = checkAuth(req);
  if (user) {
    req.user = user;
    return next();
  }

  if (req.method === 'GET') {
    return next();
  }

  if (req.method === 'POST' && req.body) {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const allowedMethods = ['initialize', 'tools/list', 'initialized', 'notifications/initialized'];

      if (body.method && allowedMethods.includes(body.method)) {
        return next();
      }

      if (body.method === 'tools/call') {
        return sendAuthRequired(req, res);
      }
    } catch (error) {
      return next();
    }
  }

  next();
}
