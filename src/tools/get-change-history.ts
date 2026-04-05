/**
 * Get Change History Tool
 *
 * Query the change event log showing what changed in the account,
 * who made the change, and when.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGaql } from '../services/google-ads.js';
import { buildGaqlQuery, getDateBounds, type DateRange } from '../utils/gaql.js';

const GetChangeHistorySchema = z.object({
  dateRange: z
    .enum(['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'])
    .default('last_7d'),
  resourceType: z
    .enum(['AD', 'AD_GROUP', 'CAMPAIGN', 'CAMPAIGN_BUDGET', 'AD_GROUP_BID_MODIFIER', 'ALL'])
    .default('ALL')
    .describe('Filter by resource type that was changed'),
  limit: z.number().int().positive().default(50),
});

export async function getChangeHistory(args: unknown): Promise<string> {
  const input = GetChangeHistorySchema.parse(args);

  try {
    const { start } = getDateBounds(input.dateRange as DateRange);
    // Use tomorrow's date for the upper bound so today's changes are included
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const endDate = tomorrow.toISOString().split('T')[0];
    const where: string[] = [
      `change_event.change_date_time >= '${start}'`,
      `change_event.change_date_time <= '${endDate}'`,
    ];

    if (input.resourceType !== 'ALL') {
      where.push(`change_event.change_resource_type = '${input.resourceType}'`);
    }

    const query = buildGaqlQuery({
      select: [
        'change_event.change_date_time',
        'change_event.change_resource_type',
        'change_event.change_resource_name',
        'change_event.client_type',
        'change_event.user_email',
        'change_event.resource_change_operation',
        'change_event.changed_fields',
        'change_event.old_resource',
        'change_event.new_resource',
        'campaign.name',
        'ad_group.name',
      ],
      from: 'change_event',
      where,
      orderBy: 'change_event.change_date_time DESC',
      limit: input.limit,
    });

    const results = await executeGaql(query);

    const changes = results.map((row: any) => {
      const ce = row.change_event || {};

      return {
        dateTime: ce.change_date_time,
        resourceType: ce.change_resource_type,
        operation: ce.resource_change_operation,
        userEmail: ce.user_email || 'System',
        clientType: ce.client_type,
        changedFields: ce.changed_fields,
        campaignName: row.campaign?.name || null,
        adGroupName: row.ad_group?.name || null,
        oldResource: ce.old_resource || null,
        newResource: ce.new_resource || null,
      };
    });

    return JSON.stringify({
      dateRange: input.dateRange,
      resourceType: input.resourceType,
      totalChanges: changes.length,
      changes,
    }, null, 2);
  } catch (error) {
    return `Error querying change history: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export const getChangeHistoryTool: Tool = {
  name: 'get-change-history',
  description: 'Query the account change history log showing what was changed, by whom, and when. Useful for auditing account modifications.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      dateRange: {
        type: 'string' as const,
        enum: ['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'],
        default: 'last_7d',
      },
      resourceType: {
        type: 'string' as const,
        enum: ['AD', 'AD_GROUP', 'CAMPAIGN', 'CAMPAIGN_BUDGET', 'AD_GROUP_BID_MODIFIER', 'ALL'],
        description: 'Filter by resource type that was changed',
        default: 'ALL',
      },
      limit: { type: 'number' as const, description: 'Max changes to return', default: 50 },
    },
  },
};
