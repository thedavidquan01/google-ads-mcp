/**
 * Compare Entities Tool
 *
 * Compare multiple campaigns or ad groups side by side.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGaql } from '../services/google-ads.js';
import { dateRangeToGaql, buildGaqlQuery, campaignStatusFilter, type DateRange } from '../utils/gaql.js';
import { microsToAmount, calculateCtr, calculateCpc, calculateCpm, safeParseNumber } from '../utils/metrics.js';

const CompareEntitiesSchema = z.object({
  dateRange: z
    .enum(['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'])
    .default('last_7d'),
  entity: z.enum(['campaign', 'ad_group']).default('campaign'),
  entityIds: z.array(z.string()).min(2).max(10).describe('IDs of entities to compare (2-10)'),
  sortBy: z
    .enum(['spend', 'impressions', 'clicks', 'conversions', 'roas'])
    .default('spend'),
});

export async function compareEntities(args: unknown): Promise<string> {
  const input = CompareEntitiesSchema.parse(args);

  try {
    const idList = input.entityIds.join(', ');
    const where: string[] = [
      dateRangeToGaql(input.dateRange as DateRange),
      `${input.entity}.id IN (${idList})`,
      campaignStatusFilter(),
    ];

    const query = buildGaqlQuery({
      select: [
        `${input.entity}.id`,
        `${input.entity}.name`,
        'metrics.impressions',
        'metrics.clicks',
        'metrics.cost_micros',
        'metrics.conversions',
        'metrics.conversions_value',
      ],
      from: input.entity,
      where,
    });

    const results = await executeGaql(query);

    const entities = results.map((row: any) => {
      const e = row[input.entity];
      const m = row.metrics;
      const impressions = safeParseNumber(m.impressions);
      const clicks = safeParseNumber(m.clicks);
      const costMicros = safeParseNumber(m.cost_micros);
      const spend = microsToAmount(costMicros);
      const conversions = safeParseNumber(m.conversions);
      const conversionValue = safeParseNumber(m.conversions_value);

      return {
        id: e.id,
        name: e.name,
        metrics: {
          impressions,
          clicks,
          spend,
          ctr: calculateCtr(impressions, clicks),
          cpc: calculateCpc(costMicros, clicks),
          cpm: calculateCpm(costMicros, impressions),
          conversions,
          conversionValue,
          roas: spend > 0 ? conversionValue / spend : 0,
          videoViews: safeParseNumber(m.video_views),
        },
      };
    });

    // Sort by requested metric
    const sortKey = input.sortBy === 'roas' ? 'roas' : input.sortBy;
    entities.sort((a: any, b: any) => (b.metrics[sortKey] || 0) - (a.metrics[sortKey] || 0));

    return JSON.stringify({
      dateRange: input.dateRange,
      entity: input.entity,
      sortBy: input.sortBy,
      entities,
    }, null, 2);
  } catch (error) {
    return `Error comparing entities: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export const compareEntitiesTool: Tool = {
  name: 'compare-entities',
  description: 'Compare 2-10 Google Ads campaigns or ad groups side by side with ranking by metric',
  inputSchema: {
    type: 'object' as const,
    properties: {
      dateRange: {
        type: 'string' as const,
        enum: ['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'],
        default: 'last_7d',
      },
      entity: { type: 'string' as const, enum: ['campaign', 'ad_group'], default: 'campaign' },
      entityIds: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'IDs of entities to compare (2-10)',
      },
      sortBy: {
        type: 'string' as const,
        enum: ['spend', 'impressions', 'clicks', 'conversions', 'roas'],
        default: 'spend',
      },
    },
    required: ['entityIds'],
  },
};
