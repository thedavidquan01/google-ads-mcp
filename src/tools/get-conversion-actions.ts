/**
 * Get Conversion Actions Tool
 *
 * Query conversion actions (including custom conversions) from Google Ads
 * with their configuration and attribution settings.
 *
 * Note: The conversion_action resource does not support metrics.
 * To get per-conversion-action performance data, query campaign or ad_group
 * resources with segments.conversion_action.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGaql } from '../services/google-ads.js';
import { buildGaqlQuery } from '../utils/gaql.js';

const GetConversionActionsSchema = z.object({
  status: z
    .enum(['ENABLED', 'REMOVED', 'HIDDEN', 'ALL'])
    .default('ENABLED')
    .describe('Filter by conversion action status'),
  category: z
    .string()
    .optional()
    .describe('Filter by category (e.g. PURCHASE, LEAD, SIGNUP, PAGE_VIEW, ADD_TO_CART, BEGIN_CHECKOUT, DEFAULT, etc.)'),
  limit: z.number().int().positive().default(100),
});

export async function getConversionActions(args: unknown): Promise<string> {
  const input = GetConversionActionsSchema.parse(args);

  try {
    const selectFields = [
      'conversion_action.id',
      'conversion_action.name',
      'conversion_action.type',
      'conversion_action.status',
      'conversion_action.category',
      'conversion_action.origin',
      'conversion_action.primary_for_goal',
      'conversion_action.counting_type',
      'conversion_action.value_settings.default_value',
      'conversion_action.value_settings.always_use_default_value',
      'conversion_action.attribution_model_settings.attribution_model',
      'conversion_action.attribution_model_settings.data_driven_model_status',
      'conversion_action.click_through_lookback_window_days',
      'conversion_action.view_through_lookback_window_days',
      'conversion_action.include_in_conversions_metric',
    ];

    const where: string[] = [];

    if (input.status !== 'ALL') {
      where.push(`conversion_action.status = '${input.status}'`);
    }

    if (input.category) {
      where.push(`conversion_action.category = '${input.category}'`);
    }

    const query = buildGaqlQuery({
      select: selectFields,
      from: 'conversion_action',
      where: where.length > 0 ? where : undefined,
      orderBy: 'conversion_action.name ASC',
      limit: input.limit,
    });

    const results = await executeGaql(query);

    const conversionActions = results.map((row: any) => {
      const ca = row.conversion_action || {};
      const vs = ca.value_settings || {};
      const ams = ca.attribution_model_settings || {};

      return {
        id: ca.id,
        name: ca.name,
        type: ca.type,
        status: ca.status,
        category: ca.category,
        origin: ca.origin,
        primaryForGoal: ca.primary_for_goal,
        countingType: ca.counting_type,
        includeInConversions: ca.include_in_conversions_metric,
        valueSettings: {
          defaultValue: vs.default_value,
          alwaysUseDefault: vs.always_use_default_value,
        },
        attribution: {
          model: ams.attribution_model,
          dataDrivenStatus: ams.data_driven_model_status,
        },
        lookbackWindows: {
          clickThroughDays: ca.click_through_lookback_window_days,
          viewThroughDays: ca.view_through_lookback_window_days,
        },
      };
    });

    return JSON.stringify({
      status: input.status,
      totalActions: conversionActions.length,
      conversionActions,
    }, null, 2);
  } catch (error) {
    return `Error querying conversion actions: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export const getConversionActionsTool: Tool = {
  name: 'get-conversion-actions',
  description:
    'List conversion actions (including custom conversions) from Google Ads with their configuration and attribution settings',
  inputSchema: {
    type: 'object' as const,
    properties: {
      status: {
        type: 'string' as const,
        enum: ['ENABLED', 'REMOVED', 'HIDDEN', 'ALL'],
        description: 'Filter by status (default: ENABLED)',
        default: 'ENABLED',
      },
      category: {
        type: 'string' as const,
        description: 'Filter by category (e.g. PURCHASE, LEAD, SIGNUP, PAGE_VIEW, ADD_TO_CART, BEGIN_CHECKOUT)',
      },
      limit: {
        type: 'number' as const,
        description: 'Max conversion actions to return',
        default: 100,
      },
    },
  },
};
