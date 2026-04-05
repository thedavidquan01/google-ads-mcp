/**
 * Get Asset Performance Tool
 *
 * Query RSA headline/description-level performance from Google Ads.
 * Shows which individual ad assets (headlines, descriptions) perform best.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGaql } from '../services/google-ads.js';
import { dateRangeToGaql, buildGaqlQuery, campaignStatusFilter, type DateRange } from '../utils/gaql.js';
import { microsToAmount, calculateCtr, calculateCpc, safeParseNumber } from '../utils/metrics.js';

const GetAssetPerformanceSchema = z.object({
  dateRange: z
    .enum(['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'])
    .default('last_30d'),
  campaignId: z.string().optional(),
  adGroupId: z.string().optional(),
  assetType: z
    .enum(['HEADLINE', 'DESCRIPTION', 'ALL'])
    .default('ALL')
    .describe('Filter by asset type'),
  limit: z.number().int().positive().default(100),
});

export async function getAssetPerformance(args: unknown): Promise<string> {
  const input = GetAssetPerformanceSchema.parse(args);

  try {
    const where: string[] = [
      dateRangeToGaql(input.dateRange as DateRange),
      campaignStatusFilter(),
    ];

    if (input.campaignId) where.push(`campaign.id = ${input.campaignId}`);
    if (input.adGroupId) where.push(`ad_group.id = ${input.adGroupId}`);
    if (input.assetType !== 'ALL') {
      where.push(`ad_group_ad_asset_view.field_type = '${input.assetType}'`);
    } else {
      where.push(`ad_group_ad_asset_view.field_type IN ('HEADLINE', 'DESCRIPTION')`);
    }

    const query = buildGaqlQuery({
      select: [
        'asset.text_asset.text',
        'asset.type',
        'ad_group_ad_asset_view.field_type',
        'ad_group_ad_asset_view.performance_label',
        'ad_group_ad_asset_view.pinned_field',
        'campaign.name',
        'campaign.id',
        'ad_group.name',
        'ad_group.id',
        'metrics.impressions',
        'metrics.clicks',
        'metrics.cost_micros',
        'metrics.conversions',
        'metrics.conversions_value',
      ],
      from: 'ad_group_ad_asset_view',
      where,
      orderBy: 'metrics.impressions DESC',
      limit: input.limit,
    });

    const results = await executeGaql(query);

    const assets = results.map((row: any) => {
      const m = row.metrics;
      const impressions = safeParseNumber(m.impressions);
      const clicks = safeParseNumber(m.clicks);
      const costMicros = safeParseNumber(m.cost_micros);
      const view = row.ad_group_ad_asset_view || {};

      return {
        text: row.asset?.text_asset?.text || 'Unknown',
        fieldType: view.field_type,
        performanceLabel: view.performance_label || 'UNRATED',
        pinnedField: view.pinned_field || null,
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
        },
      };
    });

    return JSON.stringify({
      dateRange: input.dateRange,
      assetType: input.assetType,
      totalAssets: assets.length,
      assets,
    }, null, 2);
  } catch (error) {
    return `Error querying asset performance: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export const getAssetPerformanceTool: Tool = {
  name: 'get-asset-performance',
  description: 'Query RSA headline and description asset-level performance with Google\'s performance labels (BEST, GOOD, LOW) and metrics',
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
      assetType: {
        type: 'string' as const,
        enum: ['HEADLINE', 'DESCRIPTION', 'ALL'],
        description: 'Filter by asset type',
        default: 'ALL',
      },
      limit: { type: 'number' as const, description: 'Max assets to return', default: 100 },
    },
  },
};
