/**
 * Session Management
 *
 * Defines session types and configuration for express-session.
 * Sessions store authenticated user information with 24-hour expiry.
 */

import { SessionOptions } from 'express-session';
import { env } from '../config/env.js';

/**
 * Session data stored for authenticated users
 */
export interface SessionData {
  userId: string;
  email: string;
  name: string;
  expiresAt: Date;
}

/**
 * Express session configuration with TypeScript typing
 */
declare module 'express-session' {
  interface SessionData {
    userId?: string;
    email?: string;
    name?: string;
    expiresAt?: Date;
    authRequest?: {
      clientId: string;
      redirectUri: string;
      state?: string;
      codeChallenge?: string;
      codeChallengeMethod?: string;
    };
  }
}

/**
 * Export session TTL constant
 */
export const SESSION_TTL = env.SESSION_TTL;

/**
 * Get session configuration for express-session middleware
 */
export function getSessionConfig(): SessionOptions {
  return {
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: env.SESSION_TTL,
    },
    name: 'connect.sid',
  };
}

/**
 * Calculate session expiry time
 */
export function getSessionExpiry(): Date {
  return new Date(Date.now() + env.SESSION_TTL);
}

/**
 * Calculate token expiry time (same as session)
 */
export function getTokenExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL);
}
