/**
 * Get Campaign Performance Tool
 *
 * Query campaign performance metrics including impressions, clicks, spend,
 * CTR, CPC, conversions, and ROAS from Google Ads.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGaql } from '../services/google-ads.js';
import { dateRangeToGaql, buildGaqlQuery, campaignStatusFilter, type DateRange } from '../utils/gaql.js';
import { microsToAmount, calculateCtr, calculateCpc, calculateCpm, calculateRoas, safeParseNumber } from '../utils/metrics.js';

const GetCampaignPerformanceSchema = z.object({
  dateRange: z
    .enum(['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'])
    .default('last_7d')
    .describe('Date range preset for metrics query'),
  campaignId: z
    .string()
    .optional()
    .describe('Optional campaign ID to filter results'),
  campaignType: z
    .enum(['SEARCH', 'DISPLAY', 'VIDEO', 'SHOPPING', 'PERFORMANCE_MAX', 'DEMAND_GEN'])
    .optional()
    .describe('Optional campaign type filter'),
  metrics: z
    .array(
      z.enum([
        'impressions', 'clicks', 'spend', 'ctr', 'cpc', 'cpm',
        'conversions', 'conversion_value', 'roas', 'video_views',
      ])
    )
    .default(['impressions', 'clicks', 'spend', 'ctr', 'cpc', 'conversions'])
    .describe('Metrics to include in response'),
});

export async function getCampaignPerformance(args: unknown): Promise<string> {
  const input = GetCampaignPerformanceSchema.parse(args);

  try {
    const where: string[] = [
      dateRangeToGaql(input.dateRange as DateRange),
      campaignStatusFilter(),
    ];

    if (input.campaignId) {
      where.push(`campaign.id = ${input.campaignId}`);
    }

    if (input.campaignType) {
      where.push(`campaign.advertising_channel_type = '${input.campaignType}'`);
    }

    const selectFields = [
      'campaign.id',
      'campaign.name',
      'campaign.status',
      'campaign.advertising_channel_type',
      'metrics.impressions',
      'metrics.clicks',
      'metrics.cost_micros',
      'metrics.conversions',
      'metrics.conversions_value',
    ];

    // video_views is only valid for VIDEO campaign type queries
    if (input.campaignType === 'VIDEO' || input.metrics.includes('video_views')) {
      selectFields.push('metrics.video_views');
    }

    const query = buildGaqlQuery({
      select: selectFields,
      from: 'campaign',
      where,
      orderBy: 'metrics.cost_micros DESC',
    });

    const results = await executeGaql(query);

    if (results.length === 0) {
      return JSON.stringify({
        dateRange: input.dateRange,
        campaigns: [],
        message: `No campaigns found for date range ${input.dateRange}`,
      }, null, 2);
    }

    const campaigns = results.map((row: any) => {
      const campaign = row.campaign;
      const m = row.metrics;

      const impressions = safeParseNumber(m.impressions);
      const clicks = safeParseNumber(m.clicks);
      const costMicros = safeParseNumber(m.cost_micros);
      const conversions = safeParseNumber(m.conversions);
      const conversionValue = safeParseNumber(m.conversions_value);
      const videoViews = safeParseNumber(m.video_views);

      const metrics: Record<string, number> = {};

      if (input.metrics.includes('impressions')) metrics.impressions = impressions;
      if (input.metrics.includes('clicks')) metrics.clicks = clicks;
      if (input.metrics.includes('spend')) metrics.spend = microsToAmount(costMicros);
      if (input.metrics.includes('ctr')) metrics.ctr = calculateCtr(impressions, clicks);
      if (input.metrics.includes('cpc')) metrics.cpc = calculateCpc(costMicros, clicks);
      if (input.metrics.includes('cpm')) metrics.cpm = calculateCpm(costMicros, impressions);
      if (input.metrics.includes('conversions')) metrics.conversions = conversions;
      if (input.metrics.includes('conversion_value')) metrics.conversionValue = conversionValue;
      if (input.metrics.includes('roas') && costMicros > 0) {
        metrics.roas = conversionValue / microsToAmount(costMicros);
      }
      if (input.metrics.includes('video_views')) metrics.videoViews = videoViews;

      return {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        type: campaign.advertising_channel_type,
        metrics,
      };
    });

    return JSON.stringify({
      dateRange: input.dateRange,
      campaigns,
    }, null, 2);
  } catch (error) {
    if (error instanceof Error) {
      return `Error querying campaign performance: ${error.message}`;
    }
    return 'Unknown error occurred while querying campaign performance';
  }
}

export const getCampaignPerformanceTool: Tool = {
  name: 'get-campaign-performance',
  description: 'Query Google Ads campaign performance metrics including impressions, clicks, spend, CTR, CPC, conversions, ROAS, and video views for a specified date range',
  inputSchema: {
    type: 'object' as const,
    properties: {
      dateRange: {
        type: 'string' as const,
        enum: ['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'],
        description: 'Date range preset for metrics query',
        default: 'last_7d',
      },
      campaignId: {
        type: 'string' as const,
        description: 'Optional campaign ID to filter results',
      },
      campaignType: {
        type: 'string' as const,
        enum: ['SEARCH', 'DISPLAY', 'VIDEO', 'SHOPPING', 'PERFORMANCE_MAX', 'DEMAND_GEN'],
        description: 'Optional campaign type filter',
      },
      metrics: {
        type: 'array' as const,
        items: {
          type: 'string' as const,
          enum: ['impressions', 'clicks', 'spend', 'ctr', 'cpc', 'cpm', 'conversions', 'conversion_value', 'roas', 'video_views'],
        },
        description: 'Metrics to include in response',
        default: ['impressions', 'clicks', 'spend', 'ctr', 'cpc', 'conversions'],
      },
    },
  },
};
