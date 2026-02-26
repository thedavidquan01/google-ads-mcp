/**
 * Authentication Routes
 *
 * Handles Google OAuth authentication flow endpoints:
 * - GET /auth/google - Initiate OAuth flow
 * - GET /auth/callback - Handle OAuth callback
 * - GET /auth/logout - Destroy session
 * - GET /auth/me - Get current user info
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getAuthorizationUrl, handleOAuthCallback } from '../auth/google-oauth.js';
import { requireAuth } from '../middleware/auth.js';
import { authorizationCodes } from './oauth.js';

const router = Router();

/**
 * GET /auth/google
 * Redirect user to Google OAuth consent screen
 */
router.get('/google', (req: Request, res: Response) => {
  const state = req.query.state as string | undefined;
  const authUrl = getAuthorizationUrl(state);
  res.redirect(authUrl);
});

/**
 * GET /auth/callback
 * Handle OAuth callback from Google
 */
router.get('/callback', async (req: Request, res: Response) => {
  const { code, error, error_description } = req.query;

  if (error) {
    return res.status(400).json({
      error: 'OAuth failed',
      message: error_description || error,
    });
  }

  if (!code || typeof code !== 'string') {
    return res.status(400).json({
      error: 'Invalid request',
      message: 'Authorization code is missing',
    });
  }

  try {
    const user = await handleOAuthCallback(code);

    const authRequest = req.session.authRequest;

    if (!authRequest) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
          <head><title>Invalid Request</title></head>
          <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px;">
            <h1>Invalid OAuth Request</h1>
            <p>No authorization request found. Please try again.</p>
          </body>
        </html>
      `);
    }

    const authorizationCode = crypto.randomBytes(32).toString('hex');

    authorizationCodes.set(authorizationCode, {
      code: authorizationCode,
      clientId: authRequest.clientId,
      redirectUri: authRequest.redirectUri,
      codeChallenge: authRequest.codeChallenge,
      codeChallengeMethod: authRequest.codeChallengeMethod,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      userId: user.id,
      email: user.email,
      name: user.name,
    });

    delete req.session.authRequest;

    const redirectUrl = new URL(authRequest.redirectUri);
    redirectUrl.searchParams.set('code', authorizationCode);
    if (authRequest.state) {
      redirectUrl.searchParams.set('state', authRequest.state);
    }

    console.log('[OAuth Callback] Authorization successful for:', user.email);
    return res.redirect(redirectUrl.toString());
  } catch (error) {
    console.error('OAuth callback error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({
      error: 'Authentication failed',
      message: errorMessage,
    });
  }
});

/**
 * GET /auth/logout
 */
router.get('/logout', (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
      return res.status(500).json({
        error: 'Logout failed',
        message: 'Failed to destroy session',
      });
    }
    res.json({
      message: 'Logged out successfully',
      loginUrl: '/auth/google',
    });
  });
});

/**
 * GET /auth/me
 */
router.get('/me', requireAuth, (req: Request, res: Response) => {
  res.json({
    userId: req.user?.userId,
    email: req.user?.email,
    name: req.user?.name,
  });
});

export default router;
