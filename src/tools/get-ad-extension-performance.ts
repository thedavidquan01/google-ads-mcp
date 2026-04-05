/**
 * Get Ad Extension (Asset) Performance Tool
 *
 * Query ad extension performance — sitelinks, callouts, structured snippets,
 * call extensions, etc.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGaql } from '../services/google-ads.js';
import { dateRangeToGaql, buildGaqlQuery, campaignStatusFilter, type DateRange } from '../utils/gaql.js';
import { microsToAmount, calculateCtr, calculateCpc, safeParseNumber } from '../utils/metrics.js';

const GetAdExtensionPerformanceSchema = z.object({
  dateRange: z
    .enum(['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'])
    .default('last_30d'),
  campaignId: z.string().optional(),
  extensionType: z
    .enum(['SITELINK', 'CALLOUT', 'STRUCTURED_SNIPPET', 'CALL', 'PRICE', 'PROMOTION', 'IMAGE', 'ALL'])
    .default('ALL')
    .describe('Filter by extension type'),
  limit: z.number().int().positive().default(50),
});

export async function getAdExtensionPerformance(args: unknown): Promise<string> {
  const input = GetAdExtensionPerformanceSchema.parse(args);

  try {
    const where: string[] = [
      dateRangeToGaql(input.dateRange as DateRange),
      campaignStatusFilter(),
    ];

    if (input.campaignId) where.push(`campaign.id = ${input.campaignId}`);
    if (input.extensionType !== 'ALL') {
      where.push(`asset_field_type_view.field_type = '${input.extensionType}'`);
    }

    const query = buildGaqlQuery({
      select: [
        'asset_field_type_view.field_type',
        'campaign.name',
        'campaign.id',
        'metrics.impressions',
        'metrics.clicks',
        'metrics.cost_micros',
        'metrics.conversions',
        'metrics.conversions_value',
      ],
      from: 'asset_field_type_view',
      where,
      orderBy: 'metrics.clicks DESC',
      limit: input.limit,
    });

    const results = await executeGaql(query);

    const extensions = results.map((row: any) => {
      const m = row.metrics;
      const impressions = safeParseNumber(m.impressions);
      const clicks = safeParseNumber(m.clicks);
      const costMicros = safeParseNumber(m.cost_micros);

      return {
        fieldType: row.asset_field_type_view?.field_type || 'UNKNOWN',
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
    });

    return JSON.stringify({
      dateRange: input.dateRange,
      extensionType: input.extensionType,
      totalExtensions: extensions.length,
      extensions,
    }, null, 2);
  } catch (error) {
    return `Error querying ad extension performance: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export const getAdExtensionPerformanceTool: Tool = {
  name: 'get-ad-extension-performance',
  description: 'Query ad extension performance — sitelinks, callouts, structured snippets, call, price, promotion, and image extensions',
  inputSchema: {
    type: 'object' as const,
    properties: {
      dateRange: {
        type: 'string' as const,
        enum: ['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'],
        default: 'last_30d',
      },
      campaignId: { type: 'string' as const, description: 'Filter by campaign ID' },
      extensionType: {
        type: 'string' as const,
        enum: ['SITELINK', 'CALLOUT', 'STRUCTURED_SNIPPET', 'CALL', 'PRICE', 'PROMOTION', 'IMAGE', 'ALL'],
        description: 'Filter by extension type',
        default: 'ALL',
      },
      limit: { type: 'number' as const, description: 'Max extensions to return', default: 50 },
    },
  },
};
