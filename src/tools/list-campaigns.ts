/**
 * List Campaigns Tool
 *
 * List all campaigns with optional status and type filtering.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGaql } from '../services/google-ads.js';
import { buildGaqlQuery } from '../utils/gaql.js';
import { microsToAmount, safeParseNumber } from '../utils/metrics.js';

const ListCampaignsSchema = z.object({
  status: z
    .enum(['ENABLED', 'PAUSED', 'REMOVED'])
    .optional()
    .describe('Filter by campaign status'),
  type: z
    .enum(['SEARCH', 'DISPLAY', 'VIDEO', 'SHOPPING', 'PERFORMANCE_MAX', 'DEMAND_GEN'])
    .optional()
    .describe('Filter by campaign type'),
  limit: z.number().int().positive().default(100),
});

export async function listCampaigns(args: unknown): Promise<string> {
  const input = ListCampaignsSchema.parse(args);

  try {
    const where: string[] = [];

    if (input.status) {
      where.push(`campaign.status = '${input.status}'`);
    } else {
      where.push(`campaign.status != 'REMOVED'`);
    }

    if (input.type) {
      where.push(`campaign.advertising_channel_type = '${input.type}'`);
    }

    const query = buildGaqlQuery({
      select: [
        'campaign.id',
        'campaign.name',
        'campaign.status',
        'campaign.advertising_channel_type',
        'campaign.bidding_strategy_type',
        'campaign_budget.amount_micros',
        'metrics.impressions',
        'metrics.cost_micros',
      ],
      from: 'campaign',
      where: where.length > 0 ? where : undefined,
      orderBy: 'campaign.name ASC',
      limit: input.limit,
    });

    const results = await executeGaql(query);

    const campaigns = results.map((row: any) => ({
      id: row.campaign.id,
      name: row.campaign.name,
      status: row.campaign.status,
      type: row.campaign.advertising_channel_type,
      biddingStrategy: row.campaign.bidding_strategy_type,
      dailyBudget: row.campaign_budget?.amount_micros
        ? microsToAmount(safeParseNumber(row.campaign_budget.amount_micros))
        : null,
      totalImpressions: safeParseNumber(row.metrics?.impressions),
      totalSpend: microsToAmount(safeParseNumber(row.metrics?.cost_micros)),
    }));

    return JSON.stringify({
      total: campaigns.length,
      campaigns,
    }, null, 2);
  } catch (error) {
    return `Error listing campaigns: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export const listCampaignsTool: Tool = {
  name: 'list-campaigns',
  description: 'List all Google Ads campaigns with status, type, budget, and basic metrics',
  inputSchema: {
    type: 'object' as const,
    properties: {
      status: {
        type: 'string' as const,
        enum: ['ENABLED', 'PAUSED', 'REMOVED'],
        description: 'Filter by campaign status',
      },
      type: {
        type: 'string' as const,
        enum: ['SEARCH', 'DISPLAY', 'VIDEO', 'SHOPPING', 'PERFORMANCE_MAX', 'DEMAND_GEN'],
        description: 'Filter by campaign type',
      },
      limit: { type: 'number' as const, default: 100 },
    },
  },
};
