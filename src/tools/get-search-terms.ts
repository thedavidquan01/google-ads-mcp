/**
 * Get Search Terms Tool
 *
 * Query the search term report showing actual user queries that triggered ads,
 * with performance metrics. Useful for negative keyword discovery and query intent analysis.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGaql } from '../services/google-ads.js';
import { dateRangeToGaql, customDateRangeToGaql, buildGaqlQuery, campaignStatusFilter, type DateRange } from '../utils/gaql.js';
import { microsToAmount, calculateCtr, calculateCpc, safeParseNumber } from '../utils/metrics.js';

const GetSearchTermsSchema = z.object({
  dateRange: z
    .enum(['last_7d', 'last_14d', 'last_30d', 'last_90d', 'last_180d', 'last_365d', 'this_month', 'last_month', 'this_year', 'last_year', 'custom'])
    .default('last_7d'),
  startDate: z
    .string()
    .optional()
    .describe('Custom start date in YYYY-MM-DD format (required when dateRange is "custom")'),
  endDate: z
    .string()
    .optional()
    .describe('Custom end date in YYYY-MM-DD format (required when dateRange is "custom")'),
  campaignId: z.string().optional(),
  adGroupId: z.string().optional(),
  limit: z.number().int().positive().default(50),
  segmentByDay: z
    .boolean()
    .default(false)
    .describe('When true, returns metrics broken down by day instead of aggregated over the date range'),
  segmentByConversionAction: z
    .boolean()
    .default(false)
    .describe('When true, returns metrics broken down by conversion action'),
});

function resolveExtendedDateRange(dateRange: string, startDate?: string, endDate?: string): string {
  // Standard presets handled by existing helper
  const standardPresets: DateRange[] = ['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'];
  if (standardPresets.includes(dateRange as DateRange)) {
    return dateRangeToGaql(dateRange as DateRange);
  }

  const now = new Date();
  const start = new Date();

  switch (dateRange) {
    case 'last_180d':
      start.setDate(start.getDate() - 180);
      return customDateRangeToGaql(fmt(start), fmt(now));
    case 'last_365d':
      start.setDate(start.getDate() - 365);
      return customDateRangeToGaql(fmt(start), fmt(now));
    case 'this_year':
      return customDateRangeToGaql(`${now.getFullYear()}-01-01`, fmt(now));
    case 'last_year': {
      const lastYear = now.getFullYear() - 1;
      return customDateRangeToGaql(`${lastYear}-01-01`, `${lastYear}-12-31`);
    }
    case 'custom':
      if (!startDate || !endDate) {
        throw new Error('startDate and endDate are required when dateRange is "custom"');
      }
      return customDateRangeToGaql(startDate, endDate);
    default:
      return dateRangeToGaql(dateRange as DateRange);
  }
}

function fmt(d: Date): string {
  return d.toISOString().split('T')[0];
}

export async function getSearchTerms(args: unknown): Promise<string> {
  const input = GetSearchTermsSchema.parse(args);

  try {
    const where: string[] = [
      resolveExtendedDateRange(input.dateRange, input.startDate, input.endDate),
      campaignStatusFilter(),
    ];

    if (input.campaignId) where.push(`campaign.id = ${input.campaignId}`);
    if (input.adGroupId) where.push(`ad_group.id = ${input.adGroupId}`);

    const selectFields = [
      'search_term_view.search_term',
      'search_term_view.status',
      'campaign.name',
      'campaign.id',
      'ad_group.name',
      'ad_group.id',
      'metrics.conversions',
      'metrics.conversions_value',
    ];

    // cost_micros is required by search_term_view
    selectFields.push('metrics.cost_micros');

    if (!input.segmentByConversionAction) {
      selectFields.push('metrics.impressions', 'metrics.clicks');
    } else {
      selectFields.push('metrics.all_conversions', 'metrics.all_conversions_value');
    }

    if (input.segmentByDay) {
      selectFields.push('segments.date');
    }

    if (input.segmentByConversionAction) {
      selectFields.push('segments.conversion_action_name');
      selectFields.push('segments.conversion_action');
    }

    const query = buildGaqlQuery({
      select: selectFields,
      from: 'search_term_view',
      where,
      orderBy: input.segmentByDay ? 'segments.date DESC, metrics.cost_micros DESC' : 'metrics.cost_micros DESC',
      limit: input.limit,
    });

    const results = await executeGaql(query);

    function buildRow(row: any) {
      const m = row.metrics;

      const entry: any = {
        searchTerm: row.search_term_view?.search_term || 'Unknown',
        status: row.search_term_view?.status || 'UNKNOWN',
        campaignName: row.campaign?.name,
        campaignId: row.campaign?.id,
        adGroupName: row.ad_group?.name,
        adGroupId: row.ad_group?.id,
      };

      if (input.segmentByConversionAction) {
        entry.conversionAction = row.segments?.conversion_action_name || 'Unknown';
        entry.metrics = {
          spend: microsToAmount(safeParseNumber(m.cost_micros)),
          conversions: safeParseNumber(m.conversions),
          conversionValue: safeParseNumber(m.conversions_value),
          allConversions: safeParseNumber(m.all_conversions),
          allConversionsValue: safeParseNumber(m.all_conversions_value),
        };
      } else {
        const impressions = safeParseNumber(m.impressions);
        const clicks = safeParseNumber(m.clicks);
        const costMicros = safeParseNumber(m.cost_micros);
        entry.metrics = {
          impressions,
          clicks,
          spend: microsToAmount(costMicros),
          ctr: calculateCtr(impressions, clicks),
          cpc: calculateCpc(costMicros, clicks),
          conversions: safeParseNumber(m.conversions),
          conversionValue: safeParseNumber(m.conversions_value),
        };
      }

      return entry;
    }

    const dateLabel = input.dateRange === 'custom'
      ? `${input.startDate} to ${input.endDate}`
      : input.dateRange;

    if (input.segmentByDay) {
      const byDate: Record<string, any[]> = {};
      for (const row of results) {
        const date = row.segments.date;
        if (!byDate[date]) byDate[date] = [];
        byDate[date].push(buildRow(row));
      }

      const daily = Object.entries(byDate)
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([date, searchTerms]) => ({ date, searchTerms }));

      return JSON.stringify({
        dateRange: dateLabel,
        segmentByDay: true,
        daily,
      }, null, 2);
    }

    const searchTerms = results.map(buildRow);

    return JSON.stringify({
      dateRange: dateLabel,
      searchTerms,
    }, null, 2);
  } catch (error) {
    return `Error querying search terms: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export const getSearchTermsTool: Tool = {
  name: 'get-search-terms',
  description: 'Query the search term report showing actual user queries that triggered ads, with performance metrics. Supports extended date ranges up to a full year or custom dates. Useful for negative keyword discovery and query intent analysis.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      dateRange: {
        type: 'string' as const,
        enum: ['last_7d', 'last_14d', 'last_30d', 'last_90d', 'last_180d', 'last_365d', 'this_month', 'last_month', 'this_year', 'last_year', 'custom'],
        description: 'Date range preset, or "custom" to use startDate/endDate',
        default: 'last_7d',
      },
      startDate: { type: 'string' as const, description: 'Custom start date (YYYY-MM-DD). Required when dateRange is "custom".' },
      endDate: { type: 'string' as const, description: 'Custom end date (YYYY-MM-DD). Required when dateRange is "custom".' },
      campaignId: { type: 'string' as const, description: 'Filter by campaign ID' },
      adGroupId: { type: 'string' as const, description: 'Filter by ad group ID' },
      limit: { type: 'number' as const, description: 'Max search terms to return', default: 50 },
      segmentByDay: { type: 'boolean' as const, description: 'When true, returns metrics broken down by day instead of aggregated over the date range', default: false },
      segmentByConversionAction: { type: 'boolean' as const, description: 'When true, returns metrics broken down by conversion action', default: false },
    },
  },
};
