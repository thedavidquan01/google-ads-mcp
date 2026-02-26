/**
 * Get Account Tool
 *
 * Returns Google Ads account information including name, currency, and status.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGaql } from '../services/google-ads.js';

const GetAccountSchema = z.object({});

export async function getAccountInfo(args: unknown): Promise<string> {
  GetAccountSchema.parse(args);

  try {
    const results = await executeGaql(`
      SELECT
        customer.id,
        customer.descriptive_name,
        customer.currency_code,
        customer.time_zone,
        customer.status,
        customer.manager,
        customer.test_account
      FROM customer
      LIMIT 1
    `);

    if (results.length === 0) {
      return JSON.stringify({ error: 'No account data found' }, null, 2);
    }

    const account = results[0].customer;

    return JSON.stringify({
      id: account.id,
      name: account.descriptive_name,
      currency: account.currency_code,
      timeZone: account.time_zone,
      status: account.status,
      isManager: account.manager,
      isTestAccount: account.test_account,
    }, null, 2);
  } catch (error) {
    if (error instanceof Error) {
      return `Error querying account info: ${error.message}`;
    }
    return 'Unknown error occurred while querying account info';
  }
}

export const getAccountTool: Tool = {
  name: 'get-account',
  description: 'Get Google Ads account information including name, currency, timezone, and status',
  inputSchema: {
    type: 'object' as const,
    properties: {},
  },
};
