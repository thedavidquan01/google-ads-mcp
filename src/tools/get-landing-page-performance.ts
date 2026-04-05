/**
 * Get Landing Page Performance Tool
 *
 * Query landing page URL-level performance metrics from Google Ads.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGaql } from '../services/google-ads.js';
import { dateRangeToGaql, buildGaqlQuery, campaignStatusFilter, type DateRange } from '../utils/gaql.js';
import { microsToAmount, calculateCtr, calculateCpc, safeParseNumber } from '../utils/metrics.js';

const GetLandingPagePerformanceSchema = z.object({
  dateRange: z
    .enum(['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'])
    .default('last_30d'),
  campaignId: z.string().optional(),
  limit: z.number().int().positive().default(50),
});

export async function getLandingPagePerformance(args: unknown): Promise<string> {
  const input = GetLandingPagePerformanceSchema.parse(args);

  try {
    const where: string[] = [
      dateRangeToGaql(input.dateRange as DateRange),
      campaignStatusFilter(),
    ];

    if (input.campaignId) where.push(`campaign.id = ${input.campaignId}`);

    const query = buildGaqlQuery({
      select: [
        'landing_page_view.unexpanded_final_url',
        'campaign.name',
        'campaign.id',
        'campaign.status',
        'metrics.impressions',
        'metrics.clicks',
        'metrics.cost_micros',
        'metrics.conversions',
        'metrics.conversions_value',
        'metrics.speed_score',
        'metrics.mobile_friendly_clicks_percentage',
        'metrics.valid_accelerated_mobile_pages_clicks_percentage',
      ],
      from: 'landing_page_view',
      where,
      orderBy: 'metrics.clicks DESC',
      limit: input.limit,
    });

    const results = await executeGaql(query);

    const pages = results.map((row: any) => {
      const m = row.metrics;
      const impressions = safeParseNumber(m.impressions);
      const clicks = safeParseNumber(m.clicks);
      const costMicros = safeParseNumber(m.cost_micros);

      return {
        url: row.landing_page_view?.unexpanded_final_url || 'Unknown',
        campaignName: row.campaign?.name,
        campaignId: row.campaign?.id,
        metrics: {
          impressions,
          clicks,
          spend: microsToAmount(costMicros),
          ctr: calculateCtr(impressions, clicks),
          cpc: calculateCpc(costMicros, clicks),
          conversions: safeParseNumber(m.conversions),
          conversionValue: safeParseNumber(m.conversions_value),
          speedScore: safeParseNumber(m.speed_score) || null,
          mobileFriendlyRate: safeParseNumber(m.mobile_friendly_clicks_percentage) || null,
          ampRate: safeParseNumber(m.valid_accelerated_mobile_pages_clicks_percentage) || null,
        },
      };
    });

    return JSON.stringify({
      dateRange: input.dateRange,
      totalPages: pages.length,
      landingPages: pages,
    }, null, 2);
  } catch (error) {
    return `Error querying landing page performance: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export const getLandingPagePerformanceTool: Tool = {
  name: 'get-landing-page-performance',
  description: 'Query landing page URL-level performance with metrics including speed score, mobile-friendliness, clicks, and conversions',
  inputSchema: {
    type: 'object' as const,
    properties: {
      dateRange: {
        type: 'string' as const,
        enum: ['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'],
        default: 'last_30d',
      },
      campaignId: { type: 'string' as const, description: 'Filter by campaign ID' },
      limit: { type: 'number' as const, description: 'Max landing pages to return', default: 50 },
    },
  },
};
