/**
 * Google Ads API Client Wrapper
 *
 * Provides typed access to Google Ads API using GAQL queries.
 * Handles MCC (manager) vs individual account flows.
 */

import { GoogleAdsApi, Customer } from 'google-ads-api';
import { env } from '../config/env.js';

let adsClient: GoogleAdsApi | null = null;
let customer: Customer | null = null;

/**
 * Initialize the Google Ads API client
 */
export function initGoogleAdsClient(oauthRefreshToken?: string): void {
  if (!env.GOOGLE_ADS_DEVELOPER_TOKEN) {
    console.warn('[Google Ads] Developer token not configured. Analytics tools will fail.');
    return;
  }

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    console.warn('[Google Ads] OAuth client credentials not configured.');
    return;
  }

  try {
    adsClient = new GoogleAdsApi({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      developer_token: env.GOOGLE_ADS_DEVELOPER_TOKEN,
    });

    // Use a placeholder refresh token; in production this would come from OAuth flow
    const refreshToken = oauthRefreshToken || process.env.GOOGLE_ADS_REFRESH_TOKEN || '';

    customer = adsClient.Customer({
      customer_id: env.GOOGLE_ADS_CUSTOMER_ID,
      login_customer_id: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || env.GOOGLE_ADS_CUSTOMER_ID,
      refresh_token: refreshToken,
    });

    console.log(`[Google Ads] Client initialized for customer: ${env.GOOGLE_ADS_CUSTOMER_ID}`);
  } catch (error) {
    console.error('[Google Ads] Failed to initialize client:', error instanceof Error ? error.message : error);
  }
}

/**
 * Execute a GAQL query against the Google Ads API
 */
export async function executeGaql(query: string): Promise<any[]> {
  if (!customer) {
    throw new Error('Google Ads client not initialized. Check GOOGLE_ADS_DEVELOPER_TOKEN and OAuth configuration.');
  }

  try {
    const results = await customer.query(query);
    return results;
  } catch (error) {
    let message: string;
    if (error instanceof Error) {
      message = error.message;
    } else if (error && typeof error === 'object') {
      // GoogleAdsFailure protobuf objects have an errors array
      const anyError = error as any;
      if (anyError.errors && Array.isArray(anyError.errors)) {
        message = anyError.errors
          .map((e: any) => e.message || e.error_code || JSON.stringify(e))
          .join('; ');
      } else {
        try {
          message = JSON.stringify(error);
        } catch {
          message = String(error);
        }
      }
    } else {
      message = String(error);
    }
    throw new Error(`Google Ads API query failed: ${message}`);
  }
}

/**
 * Get the customer instance for direct API access
 */
export function getCustomer(): Customer | null {
  return customer;
}

/**
 * Check if the Google Ads client is ready
 */
export function isGoogleAdsEnabled(): boolean {
  return customer !== null;
}

// Initialize on module load
initGoogleAdsClient();
