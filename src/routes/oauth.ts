/**
 * OAuth 2.0 Dynamic Client Registration (RFC 7591)
 *
 * Handles client registration for OAuth 2.0 Authorization Code flow with PKCE.
 * Redirects to Google OAuth for user authentication.
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { generateAccessToken } from '../auth/device-flow.js';

const router = Router();

function getBaseUrl(req: Request): string {
  if (env.NODE_ENV === 'production') {
    const callbackUrl = new URL(env.GOOGLE_CALLBACK_URL);
    return `${callbackUrl.protocol}//${callbackUrl.host}`;
  }
  return `${req.protocol}://${req.get('host')}`;
}

/**
 * GET /.well-known/oauth-authorization-server
 * OAuth 2.0 Authorization Server Metadata (RFC 8414)
 */
router.get('/.well-known/oauth-authorization-server', (req: Request, res: Response) => {
  const baseUrl = getBaseUrl(req);

  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    registration_endpoint: `${baseUrl}/register`,
    grant_types_supported: ['authorization_code'],
    response_types_supported: ['code'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256', 'plain'],
    service_documentation: `${baseUrl}/health`,
  });
});

interface AuthorizationCode {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  expiresAt: Date;
  userId?: string;
  email?: string;
  name?: string;
}

export const authorizationCodes = new Map<string, AuthorizationCode>();

/**
 * GET /authorize
 * OAuth 2.0 Authorization Code flow with PKCE
 */
router.get('/authorize', (req: Request, res: Response) => {
  const {
    response_type,
    client_id,
    redirect_uri,
    state,
    code_challenge,
    code_challenge_method,
  } = req.query;

  if (response_type !== 'code') {
    return res.status(400).json({
      error: 'unsupported_response_type',
      error_description: 'Only "code" response type is supported',
    });
  }

  if (!client_id || !redirect_uri) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing required parameters: client_id, redirect_uri',
    });
  }

  req.session.authRequest = {
    clientId: client_id as string,
    redirectUri: redirect_uri as string,
    state: state as string,
    codeChallenge: code_challenge as string,
    codeChallengeMethod: (code_challenge_method as string) || 'plain',
  };

  // Redirect to Google OAuth for user authentication
  const googleState = `oauth:${state || ''}`;
  res.redirect(`/auth/google?state=${encodeURIComponent(googleState)}`);
});

/**
 * POST /token
 * Exchanges authorization code for access token
 */
router.post('/token', async (req: Request, res: Response) => {
  const { grant_type, code, redirect_uri, client_id, code_verifier } = req.body;

  if (grant_type !== 'authorization_code') {
    return res.status(400).json({
      error: 'unsupported_grant_type',
      error_description: 'Only authorization_code grant type is supported',
    });
  }

  if (!code || !redirect_uri || !client_id) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing required parameters',
    });
  }

  const authCode = authorizationCodes.get(code);

  if (!authCode) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Invalid or expired authorization code',
    });
  }

  if (authCode.expiresAt < new Date()) {
    authorizationCodes.delete(code);
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Authorization code has expired',
    });
  }

  if (authCode.clientId !== client_id) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Client ID mismatch',
    });
  }

  if (authCode.redirectUri !== redirect_uri) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Redirect URI mismatch',
    });
  }

  if (authCode.codeChallenge) {
    if (!code_verifier) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'code_verifier is required',
      });
    }

    const method = authCode.codeChallengeMethod || 'plain';
    let computedChallenge: string;

    if (method === 'S256') {
      computedChallenge = crypto
        .createHash('sha256')
        .update(code_verifier)
        .digest('base64url');
    } else {
      computedChallenge = code_verifier;
    }

    if (computedChallenge !== authCode.codeChallenge) {
      return res.status(400).json({
        error: 'invalid_grant',
        error_description: 'Invalid code_verifier',
      });
    }
  }

  authorizationCodes.delete(code);

  const accessToken = generateAccessToken();

  await global.accessTokenStore.set(accessToken, {
    userId: authCode.userId!,
    email: authCode.email!,
    name: authCode.name!,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    createdAt: new Date(),
  });

  if (global.mcpConnectionRegistry) {
    const terminatedCount = global.mcpConnectionRegistry.terminateByUserId(authCode.userId!);
    console.log(`[OAuth Token] Terminated ${terminatedCount} stale connections for user:`, authCode.userId);
  }

  console.log('[OAuth Token] Access token issued for:', {
    clientId: authCode.clientId,
    userId: authCode.userId,
  });

  res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 24 * 60 * 60,
  });
});

/**
 * POST /register
 * OAuth 2.0 Dynamic Client Registration
 */
router.post('/register', (req: Request, res: Response) => {
  try {
    const clientMetadata = req.body;
    const clientId = `mcp_client_${crypto.randomBytes(16).toString('hex')}`;
    const clientSecret = crypto.randomBytes(32).toString('hex');

    console.log('[OAuth Registration] New client registered:', {
      clientId,
      clientName: clientMetadata?.client_name,
      redirectUris: clientMetadata?.redirect_uris,
    });

    const baseUrl = getBaseUrl(req);

    res.status(201).json({
      client_id: clientId,
      client_secret: clientSecret,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret_expires_at: 0,
      client_name: clientMetadata?.client_name || 'MCP Client',
      redirect_uris: clientMetadata?.redirect_uris || [],
      grant_types: ['authorization_code'],
      token_endpoint_auth_method: 'none',
      authorization_endpoint: `${baseUrl}/authorize`,
      token_endpoint: `${baseUrl}/token`,
      oauth_authorization_server: `${baseUrl}/.well-known/oauth-authorization-server`,
    });
  } catch (error) {
    console.error('[OAuth Registration] Error:', error);
    res.status(400).json({
      error: 'invalid_client_metadata',
      error_description: 'Failed to register client',
    });
  }
});

export default router;
