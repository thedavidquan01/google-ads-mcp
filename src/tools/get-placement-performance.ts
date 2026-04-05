/**
 * Get Placement Performance Tool
 *
 * Query placement-level performance for Display and Video campaigns.
 * Shows which websites, apps, and YouTube channels ads appeared on.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGaql } from '../services/google-ads.js';
import { dateRangeToGaql, buildGaqlQuery, campaignStatusFilter, type DateRange } from '../utils/gaql.js';
import { microsToAmount, calculateCtr, calculateCpc, safeParseNumber } from '../utils/metrics.js';

const GetPlacementPerformanceSchema = z.object({
  dateRange: z
    .enum(['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'])
    .default('last_30d'),
  campaignId: z.string().optional(),
  adGroupId: z.string().optional(),
  limit: z.number().int().positive().default(50),
});

export async function getPlacementPerformance(args: unknown): Promise<string> {
  const input = GetPlacementPerformanceSchema.parse(args);

  try {
    const where: string[] = [
      dateRangeToGaql(input.dateRange as DateRange),
      campaignStatusFilter(),
    ];

    if (input.campaignId) where.push(`campaign.id = ${input.campaignId}`);
    if (input.adGroupId) where.push(`ad_group.id = ${input.adGroupId}`);

    const query = buildGaqlQuery({
      select: [
        'detail_placement_view.display_name',
        'detail_placement_view.group_placement_target_url',
        'detail_placement_view.placement_type',
        'detail_placement_view.target_url',
        'campaign.name',
        'campaign.id',
        'ad_group.name',
        'ad_group.id',
        'metrics.impressions',
        'metrics.clicks',
        'metrics.cost_micros',
        'metrics.conversions',
        'metrics.conversions_value',
        'metrics.video_views',
      ],
      from: 'detail_placement_view',
      where,
      orderBy: 'metrics.cost_micros DESC',
      limit: input.limit,
    });

    const results = await executeGaql(query);

    const placements = results.map((row: any) => {
      const pv = row.detail_placement_view || {};
      const m = row.metrics;
      const impressions = safeParseNumber(m.impressions);
      const clicks = safeParseNumber(m.clicks);
      const costMicros = safeParseNumber(m.cost_micros);

      return {
        displayName: pv.display_name || 'Unknown',
        targetUrl: pv.target_url || pv.group_placement_target_url || null,
        placementType: pv.placement_type,
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
          videoViews: safeParseNumber(m.video_views),
        },
      };
    });

    return JSON.stringify({
      dateRange: input.dateRange,
      totalPlacements: placements.length,
      placements,
    }, null, 2);
  } catch (error) {
    return `Error querying placement performance: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export const getPlacementPerformanceTool: Tool = {
  name: 'get-placement-performance',
  description: 'Query placement-level performance for Display/Video campaigns — shows which websites, apps, and YouTube channels ads appeared on',
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
      limit: { type: 'number' as const, description: 'Max placements to return', default: 50 },
    },
  },
};
