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
  segmentByDay: z
    .boolean()
    .default(false)
    .describe('When true, returns metrics broken down by day instead of aggregated over the date range'),
  segmentByConversionAction: z
    .boolean()
    .default(false)
    .describe('When true, returns metrics broken down by conversion action'),
  includeConversionGoals: z
    .boolean()
    .default(false)
    .describe('When true, includes the conversion actions each campaign is configured to optimize toward'),
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
      'metrics.cost_micros',
      'metrics.conversions',
      'metrics.conversions_value',
    ];

    // impressions/clicks/video_views are not compatible with segments.conversion_action
    if (!input.segmentByConversionAction) {
      selectFields.push('metrics.impressions', 'metrics.clicks');
      // video_views is only valid for VIDEO campaign type queries
      if (input.campaignType === 'VIDEO' || input.metrics.includes('video_views')) {
        selectFields.push('metrics.video_views');
      }
    } else {
      selectFields.push('metrics.all_conversions', 'metrics.all_conversions_value');
    }

    // Include date segment for daily breakdown
    if (input.segmentByDay) {
      selectFields.push('segments.date');
    }

    // Include conversion action segment
    if (input.segmentByConversionAction) {
      selectFields.push('segments.conversion_action_name');
      selectFields.push('segments.conversion_action');
    }

    let orderBy = 'metrics.cost_micros DESC';
    if (input.segmentByDay) {
      orderBy = 'segments.date DESC, metrics.cost_micros DESC';
    }

    const query = buildGaqlQuery({
      select: selectFields,
      from: 'campaign',
      where,
      orderBy,
    });

    const results = await executeGaql(query);

    // Fetch campaign conversion goals if requested
    let conversionGoalsByCampaign: Record<string, any[]> = {};
    if (input.includeConversionGoals) {
      const goalWhere: string[] = [campaignStatusFilter()];
      if (input.campaignId) goalWhere.push(`campaign.id = ${input.campaignId}`);
      if (input.campaignType) goalWhere.push(`campaign.advertising_channel_type = '${input.campaignType}'`);

      const goalQuery = buildGaqlQuery({
        select: [
          'campaign.id',
          'campaign_conversion_goal.category',
          'campaign_conversion_goal.origin',
          'campaign_conversion_goal.biddable',
        ],
        from: 'campaign_conversion_goal',
        where: goalWhere,
      });

      try {
        const goalResults = await executeGaql(goalQuery);
        for (const row of goalResults) {
          const campaignId = String(row.campaign?.id);
          if (!conversionGoalsByCampaign[campaignId]) {
            conversionGoalsByCampaign[campaignId] = [];
          }
          const goal = row.campaign_conversion_goal || {};
          conversionGoalsByCampaign[campaignId].push({
            category: goal.category,
            origin: goal.origin,
            biddable: goal.biddable,
          });
        }
      } catch {
        // If conversion goals query fails, continue without them
      }
    }

    if (results.length === 0) {
      return JSON.stringify({
        dateRange: input.dateRange,
        segmentByDay: input.segmentByDay,
        campaigns: [],
        message: `No campaigns found for date range ${input.dateRange}`,
      }, null, 2);
    }

    function buildMetrics(m: any): Record<string, number> {
      const metrics: Record<string, number> = {};

      if (input.segmentByConversionAction) {
        metrics.spend = microsToAmount(safeParseNumber(m.cost_micros));
        metrics.conversions = safeParseNumber(m.conversions);
        metrics.conversionValue = safeParseNumber(m.conversions_value);
        metrics.allConversions = safeParseNumber(m.all_conversions);
        metrics.allConversionsValue = safeParseNumber(m.all_conversions_value);
      } else {
        const impressions = safeParseNumber(m.impressions);
        const clicks = safeParseNumber(m.clicks);
        const costMicros = safeParseNumber(m.cost_micros);
        const conversions = safeParseNumber(m.conversions);
        const conversionValue = safeParseNumber(m.conversions_value);
        const videoViews = safeParseNumber(m.video_views);

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
      }

      return metrics;
    }

    function buildCampaignRow(row: any) {
      const campaignId = String(row.campaign.id);
      const entry: any = {
        id: row.campaign.id,
        name: row.campaign.name,
        status: row.campaign.status,
        type: row.campaign.advertising_channel_type,
        metrics: buildMetrics(row.metrics),
      };
      if (input.segmentByConversionAction) {
        entry.conversionAction = row.segments?.conversion_action_name || 'Unknown';
      }
      if (input.includeConversionGoals && conversionGoalsByCampaign[campaignId]) {
        entry.conversionGoals = conversionGoalsByCampaign[campaignId];
      }
      return entry;
    }

    if (input.segmentByDay) {
      // Group results by date, then list campaigns within each date
      const byDate: Record<string, any[]> = {};
      for (const row of results) {
        const date = row.segments.date;
        if (!byDate[date]) byDate[date] = [];
        byDate[date].push(buildCampaignRow(row));
      }

      const daily = Object.entries(byDate)
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([date, campaigns]) => ({ date, campaigns }));

      return JSON.stringify({
        dateRange: input.dateRange,
        segmentByDay: true,
        segmentByConversionAction: input.segmentByConversionAction,
        daily,
      }, null, 2);
    }

    const campaigns = results.map(buildCampaignRow);

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
      segmentByDay: {
        type: 'boolean' as const,
        description: 'When true, returns metrics broken down by day instead of aggregated over the date range',
        default: false,
      },
      segmentByConversionAction: {
        type: 'boolean' as const,
        description: 'When true, returns metrics broken down by conversion action',
        default: false,
      },
      includeConversionGoals: {
        type: 'boolean' as const,
        description: 'When true, includes the conversion actions each campaign is configured to optimize toward',
        default: false,
      },
    },
  },
};
