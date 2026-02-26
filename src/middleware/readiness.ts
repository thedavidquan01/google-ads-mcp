/**
 * Readiness Middleware
 *
 * Blocks MCP requests until server is ready (tokens loaded from database).
 */

import { Request, Response, NextFunction } from 'express';

export async function waitForReadiness(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!global.serverReadiness) {
    return next();
  }

  if (global.serverReadiness.isReady()) {
    return next();
  }

  const state = await global.serverReadiness.waitUntilReady(5000);

  if (state === 'starting') {
    res.setHeader('Retry-After', '3');
    res.status(503).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Server starting up - authentication tokens loading from database. Please retry in 3 seconds.',
        data: {
          state: 'starting',
          readiness: global.serverReadiness.getStatus(),
        },
      },
      id: null,
    });
    return;
  }

  if (state === 'degraded') {
    console.warn('[Readiness] Request proceeding in degraded state');
  }

  next();
}
