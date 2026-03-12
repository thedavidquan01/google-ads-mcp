/**
 * Google OAuth 2.0 Implementation
 *
 * Handles the OAuth flow for authenticating users with Google:
 * 1. Generate OAuth authorization URL
 * 2. Exchange authorization code for access token
 * 3. Fetch user profile information
 *
 * Scopes: Google Ads (readonly)
 */

import axios from 'axios';
import { env } from '../config/env.js';

const GOOGLE_OAUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo';

// Scopes required for Google Ads readonly access
const SCOPES = [
  'https://www.googleapis.com/auth/adwords',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

export interface GoogleUser {
  id: string;
  name: string;
  email: string;
}

/**
 * Check if Google OAuth is configured
 */
export function isGoogleOAuthConfigured(): boolean {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/**
 * Generate Google OAuth authorization URL
 */
export function getAuthorizationUrl(state?: string): string {
  if (!env.GOOGLE_CLIENT_ID) {
    throw new Error('GOOGLE_CLIENT_ID not configured. Set it to enable OAuth.');
  }

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_CALLBACK_URL,
    scope: SCOPES,
    response_type: 'code',
    access_type: 'offline', // Get refresh token
    prompt: 'consent',      // Always show consent screen for refresh token
    ...(state && { state }),
  });

  return `${GOOGLE_OAUTH_BASE}?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
async function exchangeCodeForToken(code: string): Promise<{ accessToken: string; refreshToken?: string }> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET not configured.');
  }

  const response = await axios.post(GOOGLE_TOKEN_ENDPOINT, new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: env.GOOGLE_CALLBACK_URL,
    code,
    grant_type: 'authorization_code',
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  if (!response.data.access_token) {
    throw new Error('Failed to obtain access token from Google');
  }

  return {
    accessToken: response.data.access_token,
    refreshToken: response.data.refresh_token,
  };
}

/**
 * Fetch user profile information from Google
 */
async function getUserProfile(accessToken: string): Promise<GoogleUser> {
  const response = await axios.get(GOOGLE_USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.data.id) {
    console.error('Google API response:', response.data);
    throw new Error('Failed to fetch user ID from Google');
  }

  console.log('Google user authenticated:', {
    id: response.data.id,
    name: response.data.name,
    hasEmail: !!response.data.email,
  });

  return {
    id: response.data.id,
    name: response.data.name || 'Google User',
    email: response.data.email || `${response.data.id}@google.user`,
  };
}

/**
 * Complete OAuth flow: exchange code for token and fetch user profile
 */
export async function handleOAuthCallback(code: string): Promise<GoogleUser> {
  try {
    const { accessToken } = await exchangeCodeForToken(code);
    const user = await getUserProfile(accessToken);
    return user;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        `Google OAuth error: ${error.response?.data?.error_description || error.response?.data?.error || error.message}`
      );
    }
    throw error;
  }
}
