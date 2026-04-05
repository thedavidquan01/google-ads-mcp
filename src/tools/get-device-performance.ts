/**
 * Get Device Performance Tool
 *
 * Query campaign performance segmented by device (mobile, desktop, tablet).
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGaql } from '../services/google-ads.js';
import { dateRangeToGaql, buildGaqlQuery, campaignStatusFilter, type DateRange } from '../utils/gaql.js';
import { microsToAmount, calculateCtr, calculateCpc, calculateCpm, safeParseNumber } from '../utils/metrics.js';

const GetDevicePerformanceSchema = z.object({
  dateRange: z
    .enum(['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'])
    .default('last_30d'),
  campaignId: z.string().optional(),
});

export async function getDevicePerformance(args: unknown): Promise<string> {
  const input = GetDevicePerformanceSchema.parse(args);

  try {
    const where: string[] = [
      dateRangeToGaql(input.dateRange as DateRange),
      campaignStatusFilter(),
    ];

    if (input.campaignId) where.push(`campaign.id = ${input.campaignId}`);

    const query = buildGaqlQuery({
      select: [
        'segments.device',
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
      orderBy: 'metrics.cost_micros DESC',
    });

    const results = await executeGaql(query);

    const rows = results.map((row: any) => {
      const m = row.metrics;
      const impressions = safeParseNumber(m.impressions);
      const clicks = safeParseNumber(m.clicks);
      const costMicros = safeParseNumber(m.cost_micros);

      return {
        device: row.segments?.device || 'UNKNOWN',
        campaignName: row.campaign?.name,
        campaignId: row.campaign?.id,
        metrics: {
          impressions,
          clicks,
          spend: microsToAmount(costMicros),
          ctr: calculateCtr(impressions, clicks),
          cpc: calculateCpc(costMicros, clicks),
          cpm: calculateCpm(costMicros, impressions),
          conversions: safeParseNumber(m.conversions),
          conversionValue: safeParseNumber(m.conversions_value),
        },
      };
    });

    return JSON.stringify({
      dateRange: input.dateRange,
      totalRows: rows.length,
      devicePerformance: rows,
    }, null, 2);
  } catch (error) {
    return `Error querying device performance: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export const getDevicePerformanceTool: Tool = {
  name: 'get-device-performance',
  description: 'Query campaign performance segmented by device (MOBILE, DESKTOP, TABLET) to identify device-level trends',
  inputSchema: {
    type: 'object' as const,
    properties: {
      dateRange: {
        type: 'string' as const,
        enum: ['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'],
        default: 'last_30d',
      },
      campaignId: { type: 'string' as const, description: 'Filter by campaign ID' },
    },
  },
};
