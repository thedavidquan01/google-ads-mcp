/**
 * Get Keyword Performance Tool
 *
 * Query search keyword metrics for Search campaigns from Google Ads.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGaql } from '../services/google-ads.js';
import { dateRangeToGaql, buildGaqlQuery, campaignStatusFilter, type DateRange } from '../utils/gaql.js';
import { microsToAmount, calculateCtr, calculateCpc, safeParseNumber } from '../utils/metrics.js';

const GetKeywordPerformanceSchema = z.object({
  dateRange: z
    .enum(['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'])
    .default('last_7d'),
  campaignId: z.string().optional(),
  adGroupId: z.string().optional(),
  limit: z.number().int().positive().default(50),
  segmentByDay: z
    .boolean()
    .default(false)
    .describe('When true, returns metrics broken down by day instead of aggregated over the date range'),
});

export async function getKeywordPerformance(args: unknown): Promise<string> {
  const input = GetKeywordPerformanceSchema.parse(args);

  try {
    const where: string[] = [
      dateRangeToGaql(input.dateRange as DateRange),
      campaignStatusFilter(),
      `ad_group_criterion.status != 'REMOVED'`,
      `ad_group_criterion.type = 'KEYWORD'`,
    ];

    if (input.campaignId) where.push(`campaign.id = ${input.campaignId}`);
    if (input.adGroupId) where.push(`ad_group.id = ${input.adGroupId}`);

    const selectFields = [
      'ad_group_criterion.keyword.text',
      'ad_group_criterion.keyword.match_type',
      'ad_group_criterion.quality_info.quality_score',
      'campaign.name',
      'ad_group.name',
      'metrics.impressions',
      'metrics.clicks',
      'metrics.cost_micros',
      'metrics.conversions',
      'metrics.conversions_value',
      'metrics.search_impression_share',
    ];

    if (input.segmentByDay) {
      selectFields.push('segments.date');
    }

    const query = buildGaqlQuery({
      select: selectFields,
      from: 'keyword_view',
      where,
      orderBy: input.segmentByDay ? 'segments.date DESC, metrics.cost_micros DESC' : 'metrics.cost_micros DESC',
      limit: input.limit,
    });

    const results = await executeGaql(query);

    function buildRow(row: any) {
      const kw = row.ad_group_criterion?.keyword;
      const qi = row.ad_group_criterion?.quality_info;
      const m = row.metrics;
      const impressions = safeParseNumber(m.impressions);
      const clicks = safeParseNumber(m.clicks);
      const costMicros = safeParseNumber(m.cost_micros);

      return {
        keyword: kw?.text || 'Unknown',
        matchType: kw?.match_type || 'UNKNOWN',
        qualityScore: qi?.quality_score || null,
        campaignName: row.campaign?.name,
        adGroupName: row.ad_group?.name,
        metrics: {
          impressions,
          clicks,
          spend: microsToAmount(costMicros),
          ctr: calculateCtr(impressions, clicks),
          cpc: calculateCpc(costMicros, clicks),
          conversions: safeParseNumber(m.conversions),
          conversionValue: safeParseNumber(m.conversions_value),
          searchImpressionShare: safeParseNumber(m.search_impression_share),
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
        .map(([date, keywords]) => ({ date, keywords }));

      return JSON.stringify({
        dateRange: input.dateRange,
        segmentByDay: true,
        daily,
      }, null, 2);
    }

    const keywords = results.map(buildRow);

    return JSON.stringify({
      dateRange: input.dateRange,
      keywords,
    }, null, 2);
  } catch (error) {
    return `Error querying keyword performance: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export const getKeywordPerformanceTool: Tool = {
  name: 'get-keyword-performance',
  description: 'Query search keyword metrics from Google Ads including quality score, impression share, and conversion data',
  inputSchema: {
    type: 'object' as const,
    properties: {
      dateRange: {
        type: 'string' as const,
        enum: ['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'],
        default: 'last_7d',
      },
      campaignId: { type: 'string' as const, description: 'Filter by campaign ID' },
      adGroupId: { type: 'string' as const, description: 'Filter by ad group ID' },
      limit: { type: 'number' as const, description: 'Max keywords to return', default: 50 },
      segmentByDay: { type: 'boolean' as const, description: 'When true, returns metrics broken down by day instead of aggregated over the date range', default: false },
    },
  },
};
