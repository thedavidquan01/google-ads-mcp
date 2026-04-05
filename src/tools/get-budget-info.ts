/**
 * Get Budget Info Tool
 *
 * Query campaign budget details including daily budgets, delivery method,
 * spend pacing, and recommended budgets.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGaql } from '../services/google-ads.js';
import { dateRangeToGaql, buildGaqlQuery, campaignStatusFilter, type DateRange } from '../utils/gaql.js';
import { microsToAmount, safeParseNumber } from '../utils/metrics.js';

const GetBudgetInfoSchema = z.object({
  dateRange: z
    .enum(['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'])
    .default('last_30d'),
  campaignId: z.string().optional(),
  status: z
    .enum(['ENABLED', 'PAUSED', 'ALL'])
    .default('ENABLED'),
});

export async function getBudgetInfo(args: unknown): Promise<string> {
  const input = GetBudgetInfoSchema.parse(args);

  try {
    const where: string[] = [
      dateRangeToGaql(input.dateRange as DateRange),
      campaignStatusFilter(),
    ];

    if (input.campaignId) where.push(`campaign.id = ${input.campaignId}`);
    if (input.status !== 'ALL') {
      where.push(`campaign.status = '${input.status}'`);
    }

    const query = buildGaqlQuery({
      select: [
        'campaign.name',
        'campaign.id',
        'campaign.status',
        'campaign_budget.amount_micros',
        'campaign_budget.delivery_method',
        'campaign_budget.explicitly_shared',
        'campaign_budget.has_recommended_budget',
        'campaign_budget.recommended_budget_amount_micros',
        'campaign_budget.recommended_budget_estimated_change_weekly_clicks',
        'campaign_budget.recommended_budget_estimated_change_weekly_interactions',
        'campaign_budget.total_amount_micros',
        'campaign_budget.status',
        'campaign_budget.type',
        'campaign_budget.period',
        'metrics.cost_micros',
        'metrics.impressions',
        'metrics.clicks',
        'metrics.conversions',
      ],
      from: 'campaign',
      where,
      orderBy: 'metrics.cost_micros DESC',
    });

    const results = await executeGaql(query);

    const budgets = results.map((row: any) => {
      const b = row.campaign_budget || {};
      const m = row.metrics;

      const dailyBudget = microsToAmount(safeParseNumber(b.amount_micros));
      const actualSpend = microsToAmount(safeParseNumber(m.cost_micros));

      const entry: any = {
        campaignName: row.campaign?.name,
        campaignId: row.campaign?.id,
        campaignStatus: row.campaign?.status,
        budget: {
          dailyAmount: dailyBudget,
          deliveryMethod: b.delivery_method,
          type: b.type,
          period: b.period,
          status: b.status,
          isShared: b.explicitly_shared,
          totalAmount: b.total_amount_micros ? microsToAmount(safeParseNumber(b.total_amount_micros)) : null,
        },
        metrics: {
          totalSpend: actualSpend,
          impressions: safeParseNumber(m.impressions),
          clicks: safeParseNumber(m.clicks),
          conversions: safeParseNumber(m.conversions),
        },
      };

      if (b.has_recommended_budget) {
        entry.recommendedBudget = {
          amount: microsToAmount(safeParseNumber(b.recommended_budget_amount_micros)),
          estimatedWeeklyClickChange: b.recommended_budget_estimated_change_weekly_clicks || null,
          estimatedWeeklyInteractionChange: b.recommended_budget_estimated_change_weekly_interactions || null,
        };
      }

      return entry;
    });

    return JSON.stringify({
      dateRange: input.dateRange,
      totalCampaigns: budgets.length,
      budgets,
    }, null, 2);
  } catch (error) {
    return `Error querying budget info: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export const getBudgetInfoTool: Tool = {
  name: 'get-budget-info',
  description: 'Query campaign budget details including daily budgets, delivery method, spend pacing, and Google\'s recommended budget changes',
  inputSchema: {
    type: 'object' as const,
    properties: {
      dateRange: {
        type: 'string' as const,
        enum: ['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'],
        default: 'last_30d',
      },
      campaignId: { type: 'string' as const, description: 'Filter by campaign ID' },
      status: {
        type: 'string' as const,
        enum: ['ENABLED', 'PAUSED', 'ALL'],
        description: 'Filter by campaign status',
        default: 'ENABLED',
      },
    },
  },
};
