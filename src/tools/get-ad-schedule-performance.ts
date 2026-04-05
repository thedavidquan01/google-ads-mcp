/**
 * Get Ad Schedule Performance Tool
 *
 * Query performance by hour of day and day of week to optimize ad scheduling.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGaql } from '../services/google-ads.js';
import { dateRangeToGaql, buildGaqlQuery, campaignStatusFilter, type DateRange } from '../utils/gaql.js';
import { microsToAmount, calculateCtr, calculateCpc, safeParseNumber } from '../utils/metrics.js';

const GetAdSchedulePerformanceSchema = z.object({
  dateRange: z
    .enum(['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'])
    .default('last_30d'),
  campaignId: z.string().optional(),
  segmentBy: z
    .enum(['HOUR', 'DAY_OF_WEEK'])
    .default('HOUR')
    .describe('Segment by hour of day (0-23) or day of week'),
});

export async function getAdSchedulePerformance(args: unknown): Promise<string> {
  const input = GetAdSchedulePerformanceSchema.parse(args);

  try {
    const where: string[] = [
      dateRangeToGaql(input.dateRange as DateRange),
      campaignStatusFilter(),
    ];

    if (input.campaignId) where.push(`campaign.id = ${input.campaignId}`);

    const segmentField = input.segmentBy === 'HOUR'
      ? 'segments.hour'
      : 'segments.day_of_week';

    const query = buildGaqlQuery({
      select: [
        segmentField,
        'campaign.name',
        'campaign.id',
        'metrics.impressions',
        'metrics.clicks',
        'metrics.cost_micros',
        'metrics.conversions',
        'metrics.conversions_value',
      ],
      from: 'campaign',
      where,
      orderBy: `${segmentField} ASC`,
    });

    const results = await executeGaql(query);

    const rows = results.map((row: any) => {
      const m = row.metrics;
      const impressions = safeParseNumber(m.impressions);
      const clicks = safeParseNumber(m.clicks);
      const costMicros = safeParseNumber(m.cost_micros);

      const entry: any = {
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
        },
      };

      if (input.segmentBy === 'HOUR') {
        entry.hour = row.segments?.hour;
      } else {
        entry.dayOfWeek = row.segments?.day_of_week;
      }

      return entry;
    });

    return JSON.stringify({
      dateRange: input.dateRange,
      segmentBy: input.segmentBy,
      totalRows: rows.length,
      schedulePerformance: rows,
    }, null, 2);
  } catch (error) {
    return `Error querying ad schedule performance: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export const getAdSchedulePerformanceTool: Tool = {
  name: 'get-ad-schedule-performance',
  description: 'Query performance by hour of day or day of week to identify optimal ad scheduling windows',
  inputSchema: {
    type: 'object' as const,
    properties: {
      dateRange: {
        type: 'string' as const,
        enum: ['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'],
        default: 'last_30d',
      },
      campaignId: { type: 'string' as const, description: 'Filter by campaign ID' },
      segmentBy: {
        type: 'string' as const,
        enum: ['HOUR', 'DAY_OF_WEEK'],
        description: 'Segment by hour of day (0-23) or day of week',
        default: 'HOUR',
      },
    },
  },
};
