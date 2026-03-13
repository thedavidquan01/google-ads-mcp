/**
 * Get Ad Performance Tool
 *
 * Query individual ad performance metrics from Google Ads.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGaql } from '../services/google-ads.js';
import { dateRangeToGaql, buildGaqlQuery, campaignStatusFilter, type DateRange } from '../utils/gaql.js';
import { microsToAmount, calculateCtr, calculateCpc, safeParseNumber } from '../utils/metrics.js';

const GetAdPerformanceSchema = z.object({
  dateRange: z
    .enum(['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'])
    .default('last_7d'),
  campaignId: z.string().optional(),
  adGroupId: z.string().optional(),
  limit: z.number().int().positive().default(50),
});

export async function getAdPerformance(args: unknown): Promise<string> {
  const input = GetAdPerformanceSchema.parse(args);

  try {
    const where: string[] = [
      dateRangeToGaql(input.dateRange as DateRange),
      campaignStatusFilter(),
      `ad_group_ad.status != 'REMOVED'`,
    ];

    if (input.campaignId) where.push(`campaign.id = ${input.campaignId}`);
    if (input.adGroupId) where.push(`ad_group.id = ${input.adGroupId}`);

    const query = buildGaqlQuery({
      select: [
        'ad_group_ad.ad.id',
        'ad_group_ad.ad.type',
        'ad_group_ad.ad.name',
        'ad_group_ad.status',
        'ad_group_ad.ad.final_urls',
        'campaign.id',
        'campaign.name',
        'ad_group.id',
        'ad_group.name',
        'metrics.impressions',
        'metrics.clicks',
        'metrics.cost_micros',
        'metrics.conversions',
        'metrics.conversions_value',
      ],
      from: 'ad_group_ad',
      where,
      orderBy: 'metrics.cost_micros DESC',
      limit: input.limit,
    });

    const results = await executeGaql(query);

    const ads = results.map((row: any) => {
      const ad = row.ad_group_ad.ad;
      const m = row.metrics;
      const impressions = safeParseNumber(m.impressions);
      const clicks = safeParseNumber(m.clicks);
      const costMicros = safeParseNumber(m.cost_micros);

      return {
        adId: ad.id,
        adType: ad.type,
        adName: ad.name || 'Untitled',
        status: row.ad_group_ad.status,
        finalUrls: ad.final_urls || [],
        campaignId: row.campaign.id,
        campaignName: row.campaign.name,
        adGroupId: row.ad_group.id,
        adGroupName: row.ad_group.name,
        metrics: {
          impressions,
          clicks,
          spend: microsToAmount(costMicros),
          ctr: calculateCtr(impressions, clicks),
          cpc: calculateCpc(costMicros, clicks),
          conversions: safeParseNumber(m.conversions),
          conversionValue: safeParseNumber(m.conversions_value),
          videoViews: safeParseNumber(m.video_views),
          videoQuartile25: safeParseNumber(m.video_quartile_p25_rate),
          videoQuartile50: safeParseNumber(m.video_quartile_p50_rate),
          videoQuartile75: safeParseNumber(m.video_quartile_p75_rate),
          videoQuartile100: safeParseNumber(m.video_quartile_p100_rate),
        },
      };
    });

    return JSON.stringify({
      dateRange: input.dateRange,
      ads,
    }, null, 2);
  } catch (error) {
    return `Error querying ad performance: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export const getAdPerformanceTool: Tool = {
  name: 'get-ad-performance',
  description: 'Query individual ad performance metrics from Google Ads including video quartile completion rates',
  inputSchema: {
    type: 'object' as const,
    properties: {
      dateRange: {
        type: 'string' as const,
        enum: ['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'],
        default: 'last_7d',
      },
      campaignId: { type: 'string' as const, description: 'Filter by campaign ID' },
      adGroupId: { type: 'string' as const, description: 'Filter by ad group ID' },
      limit: { type: 'number' as const, description: 'Maximum number of ads to return', default: 50 },
    },
  },
};
