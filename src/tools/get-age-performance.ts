/**
 * Get Age Performance Tool
 *
 * Query ad metrics broken down by age range across all campaign types.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGaql } from '../services/google-ads.js';
import { dateRangeToGaql, buildGaqlQuery, campaignStatusFilter, type DateRange } from '../utils/gaql.js';
import { microsToAmount, calculateCtr, calculateCpc, safeParseNumber } from '../utils/metrics.js';

const GetAgePerformanceSchema = z.object({
  dateRange: z
    .enum(['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'])
    .default('last_7d'),
  campaignId: z.string().optional(),
  campaignType: z
    .enum(['SEARCH', 'DISPLAY', 'VIDEO', 'SHOPPING', 'PERFORMANCE_MAX', 'DEMAND_GEN'])
    .optional()
    .describe('Optional campaign type filter'),
  segmentByDay: z
    .boolean()
    .default(false)
    .describe('When true, returns metrics broken down by day instead of aggregated over the date range'),
});

export async function getAgePerformance(args: unknown): Promise<string> {
  const input = GetAgePerformanceSchema.parse(args);

  try {
    const where: string[] = [
      dateRangeToGaql(input.dateRange as DateRange),
      campaignStatusFilter(),
    ];

    if (input.campaignId) where.push(`campaign.id = ${input.campaignId}`);
    if (input.campaignType) where.push(`campaign.advertising_channel_type = '${input.campaignType}'`);

    const selectFields = [
      'ad_group_criterion.age_range.type',
      'campaign.name',
      'campaign.id',
      'campaign.advertising_channel_type',
      'metrics.impressions',
      'metrics.clicks',
      'metrics.cost_micros',
      'metrics.conversions',
      'metrics.conversions_value',
    ];

    if (input.segmentByDay) {
      selectFields.push('segments.date');
    }

    const query = buildGaqlQuery({
      select: selectFields,
      from: 'age_range_view',
      where,
      orderBy: input.segmentByDay ? 'segments.date DESC, metrics.impressions DESC' : 'metrics.impressions DESC',
    });

    const results = await executeGaql(query);

    function buildRow(row: any) {
      const m = row.metrics;
      const impressions = safeParseNumber(m.impressions);
      const clicks = safeParseNumber(m.clicks);
      const costMicros = safeParseNumber(m.cost_micros);

      return {
        ageRange: row.ad_group_criterion?.age_range?.type || 'UNKNOWN',
        campaignName: row.campaign?.name,
        campaignId: row.campaign?.id,
        campaignType: row.campaign?.advertising_channel_type,
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
        .map(([date, ageBreakdown]) => ({ date, ageBreakdown }));

      return JSON.stringify({
        dateRange: input.dateRange,
        segmentByDay: true,
        daily,
      }, null, 2);
    }

    const ageBreakdown = results.map(buildRow);

    return JSON.stringify({
      dateRange: input.dateRange,
      ageBreakdown,
    }, null, 2);
  } catch (error) {
    return `Error querying age performance: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export const getAgePerformanceTool: Tool = {
  name: 'get-age-performance',
  description: 'Query ad metrics broken down by age range (18-24, 25-34, 35-44, 45-54, 55-64, 65+) across all campaign types from Google Ads',
  inputSchema: {
    type: 'object' as const,
    properties: {
      dateRange: {
        type: 'string' as const,
        enum: ['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'],
        default: 'last_7d',
      },
      campaignId: { type: 'string' as const, description: 'Filter by campaign ID' },
      campaignType: {
        type: 'string' as const,
        enum: ['SEARCH', 'DISPLAY', 'VIDEO', 'SHOPPING', 'PERFORMANCE_MAX', 'DEMAND_GEN'],
        description: 'Optional campaign type filter',
      },
      segmentByDay: { type: 'boolean' as const, description: 'When true, returns metrics broken down by day instead of aggregated over the date range', default: false },
    },
  },
};
