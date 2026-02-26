/**
 * Environment Configuration
 *
 * Validates and exports environment variables required for Google Ads API.
 * Uses zod for runtime validation with clear error messages.
 */

import { z } from 'zod';

const envSchema = z.object({
  // Google Ads API
  GOOGLE_ADS_DEVELOPER_TOKEN: z
    .string()
    .min(1, 'GOOGLE_ADS_DEVELOPER_TOKEN is required. Apply at Google Ads API Center.'),
  GOOGLE_ADS_CUSTOMER_ID: z
    .string()
    .min(1, 'GOOGLE_ADS_CUSTOMER_ID is required (format: 123-456-7890 or 1234567890)')
    .transform((val) => val.replace(/-/g, '')), // Strip hyphens
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: z
    .string()
    .optional()
    .transform((val) => val?.replace(/-/g, '')),

  // Google OAuth 2.0
  GOOGLE_CLIENT_ID: z
    .string()
    .optional(),
  GOOGLE_CLIENT_SECRET: z
    .string()
    .optional(),
  GOOGLE_CALLBACK_URL: z
    .string()
    .url('GOOGLE_CALLBACK_URL must be a valid URL')
    .default('http://localhost:3000/auth/callback'),

  // Server
  PORT: z
    .string()
    .optional()
    .default('3000')
    .transform((val) => parseInt(val, 10)),
  HOST: z
    .string()
    .optional()
    .default('0.0.0.0'),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .optional()
    .default('development'),
  SESSION_SECRET: z
    .string()
    .min(1)
    .default('fly-io-default-session-secret-change-me-in-prod-32chars'),
  SESSION_TTL: z
    .string()
    .optional()
    .default('86400000')
    .transform((val) => parseInt(val, 10)),

  // Google Cloud Platform Configuration (optional - for video analysis features)
  GOOGLE_SERVICE_ACCOUNT_JSON: z
    .string()
    .optional()
    .refine((val) => {
      if (!val) return true;
      try {
        JSON.parse(val);
        return true;
      } catch {
        return false;
      }
    }, 'Invalid JSON format for GOOGLE_SERVICE_ACCOUNT_JSON'),
  GCS_BUCKET_NAME: z
    .string()
    .default('google-ads-videos'),
  FIRESTORE_CACHE_TTL_HOURS: z
    .coerce
    .number()
    .int()
    .positive()
    .default(24),
  GCP_PROJECT_ID: z
    .string()
    .optional(),

  // Gemini AI Configuration (optional - for video content analysis)
  GEMINI_API_KEY: z
    .string()
    .optional(),
  GEMINI_MODEL: z
    .string()
    .default('gemini-2.5-flash'),
  GEMINI_USE_VERTEX_AI: z
    .coerce
    .boolean()
    .default(false),
  GEMINI_MAX_COST_PER_ANALYSIS: z
    .coerce
    .number()
    .positive()
    .default(0.10),
  GEMINI_MAX_CONCURRENT_ANALYSES: z
    .coerce
    .number()
    .int()
    .positive()
    .default(2),
});

// Parse and validate environment variables
const parseEnv = () => {
  try {
    const parsed = envSchema.parse({
      GOOGLE_ADS_DEVELOPER_TOKEN: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
      GOOGLE_ADS_CUSTOMER_ID: process.env.GOOGLE_ADS_CUSTOMER_ID,
      GOOGLE_ADS_LOGIN_CUSTOMER_ID: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
      GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL,
      PORT: process.env.PORT,
      HOST: process.env.HOST,
      NODE_ENV: process.env.NODE_ENV,
      SESSION_SECRET: process.env.SESSION_SECRET,
      SESSION_TTL: process.env.SESSION_TTL,
      GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
      GCS_BUCKET_NAME: process.env.GCS_BUCKET_NAME,
      FIRESTORE_CACHE_TTL_HOURS: process.env.FIRESTORE_CACHE_TTL_HOURS,
      GCP_PROJECT_ID: process.env.GCP_PROJECT_ID,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      GEMINI_MODEL: process.env.GEMINI_MODEL,
      GEMINI_USE_VERTEX_AI: process.env.GEMINI_USE_VERTEX_AI,
      GEMINI_MAX_COST_PER_ANALYSIS: process.env.GEMINI_MAX_COST_PER_ANALYSIS,
      GEMINI_MAX_CONCURRENT_ANALYSES: process.env.GEMINI_MAX_CONCURRENT_ANALYSES,
    });

    if (!parsed.GEMINI_USE_VERTEX_AI && !parsed.GEMINI_API_KEY) {
      console.warn('Gemini AI not configured: GEMINI_API_KEY not set. Video analysis features will be disabled.');
    }

    if (parsed.GEMINI_USE_VERTEX_AI && !parsed.GOOGLE_SERVICE_ACCOUNT_JSON) {
      console.warn('Gemini Vertex AI mode enabled but GOOGLE_SERVICE_ACCOUNT_JSON not configured. Video analysis features will be disabled.');
    }

    return parsed;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.issues.map((err) => `  - ${err.path.join('.')}: ${err.message}`);
      throw new Error(
        `Environment validation failed:\n${messages.join('\n')}\n\nPlease check your .env file.`
      );
    }
    throw error;
  }
};

export const env = parseEnv();
