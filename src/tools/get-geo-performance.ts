/**
 * Get Geographic Performance Tool
 *
 * Query ad metrics broken down by geographic location (country, region, city)
 * across all campaign types.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGaql } from '../services/google-ads.js';
import { dateRangeToGaql, buildGaqlQuery, campaignStatusFilter, type DateRange } from '../utils/gaql.js';
import { microsToAmount, calculateCtr, calculateCpc, safeParseNumber } from '../utils/metrics.js';

const GetGeoPerformanceSchema = z.object({
  dateRange: z
    .enum(['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'])
    .default('last_7d'),
  campaignId: z.string().optional(),
  campaignType: z
    .enum(['SEARCH', 'DISPLAY', 'VIDEO', 'SHOPPING', 'PERFORMANCE_MAX', 'DEMAND_GEN'])
    .optional()
    .describe('Optional campaign type filter'),
  granularity: z
    .enum(['country', 'region', 'city'])
    .default('country')
    .describe('Geographic detail level'),
  limit: z.number().int().positive().default(50),
  segmentByDay: z
    .boolean()
    .default(false)
    .describe('When true, returns metrics broken down by day instead of aggregated over the date range'),
});

/**
 * Extract numeric geo target constant ID from resource name string.
 * e.g. "geoTargetConstants/2840" → "2840"
 */
function parseGeoId(resourceName: string | undefined): string | null {
  if (!resourceName) return null;
  const parts = resourceName.split('/');
  return parts.length > 1 ? parts[parts.length - 1] : resourceName;
}

export async function getGeoPerformance(args: unknown): Promise<string> {
  const input = GetGeoPerformanceSchema.parse(args);

  try {
    const where: string[] = [
      dateRangeToGaql(input.dateRange as DateRange),
      campaignStatusFilter(),
    ];

    if (input.campaignId) where.push(`campaign.id = ${input.campaignId}`);
    if (input.campaignType) where.push(`campaign.advertising_channel_type = '${input.campaignType}'`);

    const selectFields = [
      'geographic_view.country_criterion_id',
      'geographic_view.location_type',
      'campaign.name',
      'campaign.id',
      'campaign.status',
      'campaign.advertising_channel_type',
      'metrics.impressions',
      'metrics.clicks',
      'metrics.cost_micros',
      'metrics.conversions',
      'metrics.conversions_value',
    ];

    if (input.granularity === 'region' || input.granularity === 'city') {
      selectFields.push('segments.geo_target_region');
    }
    if (input.granularity === 'city') {
      selectFields.push('segments.geo_target_city');
    }

    if (input.segmentByDay) {
      selectFields.push('segments.date');
    }

    const query = buildGaqlQuery({
      select: selectFields,
      from: 'geographic_view',
      where,
      orderBy: input.segmentByDay ? 'segments.date DESC, metrics.cost_micros DESC' : 'metrics.cost_micros DESC',
      limit: input.limit,
    });

    const results = await executeGaql(query);

    function buildRow(row: any) {
      const m = row.metrics;
      const impressions = safeParseNumber(m.impressions);
      const clicks = safeParseNumber(m.clicks);
      const costMicros = safeParseNumber(m.cost_micros);

      const geoRow: any = {
        countryGeoId: row.geographic_view?.country_criterion_id?.toString() || null,
        locationType: row.geographic_view?.location_type || 'UNKNOWN',
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

      if (input.granularity === 'region' || input.granularity === 'city') {
        geoRow.regionGeoId = parseGeoId(row.segments?.geo_target_region);
      }
      if (input.granularity === 'city') {
        geoRow.cityGeoId = parseGeoId(row.segments?.geo_target_city);
      }

      return geoRow;
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
        .map(([date, geoBreakdown]) => ({ date, geoBreakdown }));

      return JSON.stringify({
        dateRange: input.dateRange,
        granularity: input.granularity,
        segmentByDay: true,
        daily,
      }, null, 2);
    }

    const geoBreakdown = results.map(buildRow);

    return JSON.stringify({
      dateRange: input.dateRange,
      granularity: input.granularity,
      geoBreakdown,
    }, null, 2);
  } catch (error) {
    return `Error querying geo performance: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export const getGeoPerformanceTool: Tool = {
  name: 'get-geo-performance',
  description: 'Query ad metrics broken down by geographic location (country, region, or city) across all campaign types from Google Ads',
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
      granularity: {
        type: 'string' as const,
        enum: ['country', 'region', 'city'],
        description: 'Geographic detail level',
        default: 'country',
      },
      limit: { type: 'number' as const, description: 'Max locations to return', default: 50 },
      segmentByDay: { type: 'boolean' as const, description: 'When true, returns metrics broken down by day instead of aggregated over the date range', default: false },
    },
  },
};
