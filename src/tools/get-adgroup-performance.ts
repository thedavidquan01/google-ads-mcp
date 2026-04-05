/**
 * Get Ad Group Performance Tool
 *
 * Query ad group performance metrics from Google Ads.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGaql } from '../services/google-ads.js';
import { dateRangeToGaql, buildGaqlQuery, campaignStatusFilter, type DateRange } from '../utils/gaql.js';
import { microsToAmount, calculateCtr, calculateCpc, calculateCpm, safeParseNumber } from '../utils/metrics.js';

const GetAdGroupPerformanceSchema = z.object({
  dateRange: z
    .enum(['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'])
    .default('last_7d'),
  campaignId: z
    .string()
    .optional()
    .describe('Filter by campaign ID'),
  adGroupId: z
    .string()
    .optional()
    .describe('Filter by specific ad group ID'),
  segmentByDay: z
    .boolean()
    .default(false)
    .describe('When true, returns metrics broken down by day instead of aggregated over the date range'),
  segmentByConversionAction: z
    .boolean()
    .default(false)
    .describe('When true, returns metrics broken down by conversion action'),
});

export async function getAdGroupPerformance(args: unknown): Promise<string> {
  const input = GetAdGroupPerformanceSchema.parse(args);

  try {
    const where: string[] = [
      dateRangeToGaql(input.dateRange as DateRange),
      campaignStatusFilter(),
      `ad_group.status != 'REMOVED'`,
    ];

    if (input.campaignId) where.push(`campaign.id = ${input.campaignId}`);
    if (input.adGroupId) where.push(`ad_group.id = ${input.adGroupId}`);

    const selectFields = [
      'ad_group.id',
      'ad_group.name',
      'ad_group.status',
      'ad_group.type',
      'campaign.id',
      'campaign.name',
      'metrics.cost_micros',
      'metrics.conversions',
      'metrics.conversions_value',
    ];

    // impressions/clicks are not compatible with segments.conversion_action
    if (!input.segmentByConversionAction) {
      selectFields.push('metrics.impressions', 'metrics.clicks');
    } else {
      selectFields.push('metrics.all_conversions', 'metrics.all_conversions_value');
    }

    if (input.segmentByDay) {
      selectFields.push('segments.date');
    }

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
      from: 'ad_group',
      where,
      orderBy,
    });

    const results = await executeGaql(query);

    function buildRow(row: any) {
      const ag = row.ad_group;
      const m = row.metrics;

      const entry: any = {
        id: ag.id,
        name: ag.name,
        status: ag.status,
        type: ag.type,
        campaignId: row.campaign.id,
        campaignName: row.campaign.name,
      };

      if (input.segmentByConversionAction) {
        entry.conversionAction = row.segments?.conversion_action_name || 'Unknown';
        entry.metrics = {
          spend: microsToAmount(safeParseNumber(m.cost_micros)),
          conversions: safeParseNumber(m.conversions),
          conversionValue: safeParseNumber(m.conversions_value),
          allConversions: safeParseNumber(m.all_conversions),
          allConversionsValue: safeParseNumber(m.all_conversions_value),
        };
      } else {
        const impressions = safeParseNumber(m.impressions);
        const clicks = safeParseNumber(m.clicks);
        const costMicros = safeParseNumber(m.cost_micros);
        entry.metrics = {
          impressions,
          clicks,
          spend: microsToAmount(costMicros),
          ctr: calculateCtr(impressions, clicks),
          cpc: calculateCpc(costMicros, clicks),
          cpm: calculateCpm(costMicros, impressions),
          conversions: safeParseNumber(m.conversions),
          conversionValue: safeParseNumber(m.conversions_value),
          videoViews: safeParseNumber(m.video_views),
        };
      }

      return entry;
    }

    if (input.segmentByDay) {
      const byDate: Record<string, any[]> = {};
      for (const row of results) {
        const date = row.segments.date;
        if (!byDate[date]) byDate[date] = [];
        byDate[date].push(buildRow(row));
      }

      const daily = Object.entries(byDate)
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([date, adGroups]) => ({ date, adGroups }));

      return JSON.stringify({
        dateRange: input.dateRange,
        segmentByDay: true,
        daily,
      }, null, 2);
    }

    const adGroups = results.map(buildRow);

    return JSON.stringify({
      dateRange: input.dateRange,
      adGroups,
    }, null, 2);
  } catch (error) {
    return `Error querying ad group performance: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export const getAdGroupPerformanceTool: Tool = {
  name: 'get-adgroup-performance',
  description: 'Query Google Ads ad group performance metrics including impressions, clicks, spend, CTR, CPC, conversions, and video views',
  inputSchema: {
    type: 'object' as const,
    properties: {
      dateRange: {
        type: 'string' as const,
        enum: ['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'],
        default: 'last_7d',
      },
      campaignId: { type: 'string' as const, description: 'Filter by campaign ID' },
      adGroupId: { type: 'string' as const, description: 'Filter by specific ad group ID' },
      segmentByDay: { type: 'boolean' as const, description: 'When true, returns metrics broken down by day instead of aggregated over the date range', default: false },
      segmentByConversionAction: { type: 'boolean' as const, description: 'When true, returns metrics broken down by conversion action', default: false },
    },
  },
};
