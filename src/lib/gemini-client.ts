/**
 * Gemini AI Client Initialization
 *
 * Initializes Google Generative AI client with support for both API key and Vertex AI authentication.
 * Reused from Meta Ads MCP — platform-agnostic.
 */

import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';
import { isGcpEnabled } from './gcp-clients.js';

export interface GeminiConfig {
  model: string;
  useVertexAI: boolean;
  apiKey?: string;
  project?: string;
  location?: string;
}

function initGeminiClient(): GoogleGenAI | null {
  if (!env.GEMINI_USE_VERTEX_AI && !env.GEMINI_API_KEY) {
    console.log('Gemini AI not configured. Video analysis features will be disabled.');
    return null;
  }

  if (env.GEMINI_USE_VERTEX_AI && !isGcpEnabled) {
    console.error('Vertex AI mode enabled but GCP not configured. Check GOOGLE_SERVICE_ACCOUNT_JSON.');
    return null;
  }

  try {
    let client: GoogleGenAI;

    if (env.GEMINI_USE_VERTEX_AI) {
      console.log('Initializing Gemini client with Vertex AI (service account authentication)');
      client = new GoogleGenAI({ apiKey: '' });
      console.log('Gemini client initialized successfully (Vertex AI mode)');
    } else {
      console.log('Initializing Gemini client with API key');
      client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY! });
      console.log('Gemini client initialized successfully (API key mode)');
    }

    return client;
  } catch (error) {
    console.error('Failed to initialize Gemini client:', error instanceof Error ? error.message : error);
    console.log('Server will continue without Gemini features.');
    return null;
  }
}

export const geminiClient = initGeminiClient();

export const isGeminiEnabled = (): boolean => geminiClient !== null;

export const geminiConfig: GeminiConfig = {
  model: env.GEMINI_MODEL,
  useVertexAI: env.GEMINI_USE_VERTEX_AI,
  apiKey: env.GEMINI_API_KEY,
  project: env.GCP_PROJECT_ID,
  location: 'us-central1',
};
