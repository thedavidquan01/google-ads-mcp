/**
 * Get Shopping Performance Tool
 *
 * Query product-level performance for Shopping and Performance Max campaigns.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGaql } from '../services/google-ads.js';
import { dateRangeToGaql, buildGaqlQuery, campaignStatusFilter, type DateRange } from '../utils/gaql.js';
import { microsToAmount, calculateCtr, calculateCpc, safeParseNumber } from '../utils/metrics.js';

const GetShoppingPerformanceSchema = z.object({
  dateRange: z
    .enum(['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'])
    .default('last_30d'),
  campaignId: z.string().optional(),
  limit: z.number().int().positive().default(50),
});

export async function getShoppingPerformance(args: unknown): Promise<string> {
  const input = GetShoppingPerformanceSchema.parse(args);

  try {
    const where: string[] = [
      dateRangeToGaql(input.dateRange as DateRange),
      campaignStatusFilter(),
    ];

    if (input.campaignId) where.push(`campaign.id = ${input.campaignId}`);

    const query = buildGaqlQuery({
      select: [
        'segments.product_item_id',
        'segments.product_title',
        'segments.product_brand',
        'segments.product_category_level1',
        'segments.product_custom_attribute0',
        'campaign.name',
        'campaign.id',
        'metrics.impressions',
        'metrics.clicks',
        'metrics.cost_micros',
        'metrics.conversions',
        'metrics.conversions_value',
      ],
      from: 'shopping_performance_view',
      where,
      orderBy: 'metrics.cost_micros DESC',
      limit: input.limit,
    });

    const results = await executeGaql(query);

    const products = results.map((row: any) => {
      const s = row.segments || {};
      const m = row.metrics;
      const impressions = safeParseNumber(m.impressions);
      const clicks = safeParseNumber(m.clicks);
      const costMicros = safeParseNumber(m.cost_micros);
      const conversionValue = safeParseNumber(m.conversions_value);

      return {
        productId: s.product_item_id || 'Unknown',
        productTitle: s.product_title || 'Unknown',
        productBrand: s.product_brand || null,
        productCategory: s.product_category_level1 || null,
        customAttribute0: s.product_custom_attribute0 || null,
        campaignName: row.campaign?.name,
        campaignId: row.campaign?.id,
        metrics: {
          impressions,
          clicks,
          spend: microsToAmount(costMicros),
          ctr: calculateCtr(impressions, clicks),
          cpc: calculateCpc(costMicros, clicks),
          conversions: safeParseNumber(m.conversions),
          conversionValue,
          roas: costMicros > 0 ? conversionValue / microsToAmount(costMicros) : 0,
        },
      };
    });

    return JSON.stringify({
      dateRange: input.dateRange,
      totalProducts: products.length,
      products,
    }, null, 2);
  } catch (error) {
    return `Error querying shopping performance: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export const getShoppingPerformanceTool: Tool = {
  name: 'get-shopping-performance',
  description: 'Query product-level performance for Shopping and Performance Max campaigns with product details, ROAS, and conversion metrics',
  inputSchema: {
    type: 'object' as const,
    properties: {
      dateRange: {
        type: 'string' as const,
        enum: ['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'],
        default: 'last_30d',
      },
      campaignId: { type: 'string' as const, description: 'Filter by campaign ID' },
      limit: { type: 'number' as const, description: 'Max products to return', default: 50 },
    },
  },
};
