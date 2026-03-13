/**
 * Compare Time Periods Tool
 *
 * Period-over-period comparison for campaigns/ad groups.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGaql } from '../services/google-ads.js';
import { buildGaqlQuery, customDateRangeToGaql, getDateBounds, campaignStatusFilter, type DateRange } from '../utils/gaql.js';
import { microsToAmount, calculateCtr, calculateCpc, safeParseNumber } from '../utils/metrics.js';

const CompareTimePeriodsSchema = z.object({
  dateRange: z
    .enum(['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'])
    .default('last_7d')
    .describe('Current period'),
  entity: z
    .enum(['campaign', 'ad_group'])
    .default('campaign'),
  entityId: z.string().optional().describe('Specific entity ID to compare'),
});

function shiftDateRange(dateRange: DateRange): { start: string; end: string } {
  const current = getDateBounds(dateRange);
  const currentStart = new Date(current.start);
  const currentEnd = new Date(current.end);
  const durationMs = currentEnd.getTime() - currentStart.getTime();

  const prevEnd = new Date(currentStart.getTime() - 24 * 60 * 60 * 1000); // Day before current start
  const prevStart = new Date(prevEnd.getTime() - durationMs);

  return {
    start: prevStart.toISOString().split('T')[0],
    end: prevEnd.toISOString().split('T')[0],
  };
}

async function queryPeriod(entity: string, dateCondition: string, entityId?: string): Promise<any[]> {
  const where = [dateCondition, campaignStatusFilter()];
  if (entityId) {
    where.push(`${entity}.id = ${entityId}`);
  }

  const query = buildGaqlQuery({
    select: [
      `${entity}.id`,
      `${entity}.name`,
      'metrics.impressions',
      'metrics.clicks',
      'metrics.cost_micros',
      'metrics.conversions',
      'metrics.conversions_value',
    ],
    from: entity,
    where,
    orderBy: 'metrics.cost_micros DESC',
  });

  return executeGaql(query);
}

function formatMetrics(row: any) {
  const m = row.metrics;
  const impressions = safeParseNumber(m.impressions);
  const clicks = safeParseNumber(m.clicks);
  const costMicros = safeParseNumber(m.cost_micros);

  return {
    impressions,
    clicks,
    spend: microsToAmount(costMicros),
    ctr: calculateCtr(impressions, clicks),
    cpc: calculateCpc(costMicros, clicks),
    conversions: safeParseNumber(m.conversions),
    conversionValue: safeParseNumber(m.conversions_value),
  };
}

function calculateChange(current: number, previous: number): { value: number; changePercent: number | null } {
  const changePercent = previous === 0 ? null : ((current - previous) / previous) * 100;
  return { value: current, changePercent };
}

export async function compareTimePeriods(args: unknown): Promise<string> {
  const input = CompareTimePeriodsSchema.parse(args);

  try {
    const currentBounds = getDateBounds(input.dateRange as DateRange);
    const prevBounds = shiftDateRange(input.dateRange as DateRange);

    const [currentResults, prevResults] = await Promise.all([
      queryPeriod(input.entity, customDateRangeToGaql(currentBounds.start, currentBounds.end), input.entityId),
      queryPeriod(input.entity, customDateRangeToGaql(prevBounds.start, prevBounds.end), input.entityId),
    ]);

    // Build maps for comparison
    const prevMap = new Map<string, any>();
    for (const row of prevResults) {
      const id = row[input.entity]?.id;
      if (id) prevMap.set(String(id), formatMetrics(row));
    }

    const comparison = currentResults.map((row: any) => {
      const entity = row[input.entity];
      const current = formatMetrics(row);
      const previous = prevMap.get(String(entity.id)) || {
        impressions: 0, clicks: 0, spend: 0, ctr: 0, cpc: 0, conversions: 0, conversionValue: 0,
      };

      return {
        id: entity.id,
        name: entity.name,
        currentPeriod: { start: currentBounds.start, end: currentBounds.end },
        previousPeriod: { start: prevBounds.start, end: prevBounds.end },
        impressions: calculateChange(current.impressions, previous.impressions),
        clicks: calculateChange(current.clicks, previous.clicks),
        spend: calculateChange(current.spend, previous.spend),
        ctr: calculateChange(current.ctr, previous.ctr),
        conversions: calculateChange(current.conversions, previous.conversions),
      };
    });

    return JSON.stringify({
      entity: input.entity,
      dateRange: input.dateRange,
      comparison,
    }, null, 2);
  } catch (error) {
    return `Error comparing time periods: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export const compareTimePeriodsTool: Tool = {
  name: 'compare-time-periods',
  description: 'Compare Google Ads performance between the current period and the equivalent previous period (e.g., last 7 days vs prior 7 days)',
  inputSchema: {
    type: 'object' as const,
    properties: {
      dateRange: {
        type: 'string' as const,
        enum: ['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'],
        default: 'last_7d',
      },
      entity: {
        type: 'string' as const,
        enum: ['campaign', 'ad_group'],
        default: 'campaign',
      },
      entityId: { type: 'string' as const, description: 'Specific entity ID to compare' },
    },
  },
};
