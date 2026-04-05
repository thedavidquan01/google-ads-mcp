/**
 * Get Audience Performance Tool
 *
 * Query audience segment performance (in-market, affinity, custom audiences)
 * from Google Ads.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGaql } from '../services/google-ads.js';
import { dateRangeToGaql, buildGaqlQuery, campaignStatusFilter, type DateRange } from '../utils/gaql.js';
import { microsToAmount, calculateCtr, calculateCpc, safeParseNumber } from '../utils/metrics.js';

const GetAudiencePerformanceSchema = z.object({
  dateRange: z
    .enum(['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'])
    .default('last_30d'),
  campaignId: z.string().optional(),
  adGroupId: z.string().optional(),
  limit: z.number().int().positive().default(50),
});

export async function getAudiencePerformance(args: unknown): Promise<string> {
  const input = GetAudiencePerformanceSchema.parse(args);

  try {
    const where: string[] = [
      dateRangeToGaql(input.dateRange as DateRange),
      campaignStatusFilter(),
    ];

    if (input.campaignId) where.push(`campaign.id = ${input.campaignId}`);
    if (input.adGroupId) where.push(`ad_group.id = ${input.adGroupId}`);

    const query = buildGaqlQuery({
      select: [
        'ad_group_criterion.display_name',
        'ad_group_criterion.type',
        'ad_group_criterion.status',
        'ad_group_criterion.bid_modifier',
        'campaign.name',
        'campaign.id',
        'ad_group.name',
        'ad_group.id',
        'metrics.impressions',
        'metrics.clicks',
        'metrics.cost_micros',
        'metrics.conversions',
        'metrics.conversions_value',
      ],
      from: 'ad_group_audience_view',
      where,
      orderBy: 'metrics.cost_micros DESC',
      limit: input.limit,
    });

    const results = await executeGaql(query);

    const audiences = results.map((row: any) => {
      const crit = row.ad_group_criterion || {};
      const m = row.metrics;
      const impressions = safeParseNumber(m.impressions);
      const clicks = safeParseNumber(m.clicks);
      const costMicros = safeParseNumber(m.cost_micros);

      return {
        audienceName: crit.display_name || 'Unknown',
        type: crit.type,
        status: crit.status,
        bidModifier: crit.bid_modifier,
        campaignName: row.campaign?.name,
        campaignId: row.campaign?.id,
        adGroupName: row.ad_group?.name,
        adGroupId: row.ad_group?.id,
        metrics: {
          impressions,
          clicks,
          spend: microsToAmount(costMicros),
          ctr: calculateCtr(impressions, clicks),
          cpc: calculateCpc(costMicros, clicks),
          conversions: safeParseNumber(m.conversions),
          conversionValue: safeParseNumber(m.conversions_value),
        },
      };
    });

    return JSON.stringify({
      dateRange: input.dateRange,
      totalAudiences: audiences.length,
      audiences,
    }, null, 2);
  } catch (error) {
    return `Error querying audience performance: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export const getAudiencePerformanceTool: Tool = {
  name: 'get-audience-performance',
  description: 'Query audience segment performance (in-market, affinity, custom audiences) with metrics like impressions, clicks, spend, and conversions',
  inputSchema: {
    type: 'object' as const,
    properties: {
      dateRange: {
        type: 'string' as const,
        enum: ['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'],
        default: 'last_30d',
      },
      campaignId: { type: 'string' as const, description: 'Filter by campaign ID' },
      adGroupId: { type: 'string' as const, description: 'Filter by ad group ID' },
      limit: { type: 'number' as const, description: 'Max audiences to return', default: 50 },
    },
  },
};
