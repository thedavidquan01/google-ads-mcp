/**
 * List Ad Groups Tool
 *
 * List ad groups within a campaign.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGaql } from '../services/google-ads.js';
import { buildGaqlQuery } from '../utils/gaql.js';

const ListAdGroupsSchema = z.object({
  campaignId: z.string().describe('Campaign ID to list ad groups for'),
  status: z.enum(['ENABLED', 'PAUSED', 'REMOVED']).optional(),
});

export async function listAdGroups(args: unknown): Promise<string> {
  const input = ListAdGroupsSchema.parse(args);

  try {
    const where: string[] = [
      `campaign.id = ${input.campaignId}`,
    ];

    if (input.status) {
      where.push(`ad_group.status = '${input.status}'`);
    } else {
      where.push(`ad_group.status != 'REMOVED'`);
    }

    const query = buildGaqlQuery({
      select: [
        'ad_group.id',
        'ad_group.name',
        'ad_group.status',
        'ad_group.type',
        'campaign.name',
      ],
      from: 'ad_group',
      where,
      orderBy: 'ad_group.name ASC',
    });

    const results = await executeGaql(query);

    const adGroups = results.map((row: any) => ({
      id: row.ad_group.id,
      name: row.ad_group.name,
      status: row.ad_group.status,
      type: row.ad_group.type,
      campaignName: row.campaign.name,
    }));

    return JSON.stringify({
      campaignId: input.campaignId,
      total: adGroups.length,
      adGroups,
    }, null, 2);
  } catch (error) {
    return `Error listing ad groups: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export const listAdGroupsTool: Tool = {
  name: 'list-ad-groups',
  description: 'List ad groups within a Google Ads campaign',
  inputSchema: {
    type: 'object' as const,
    properties: {
      campaignId: { type: 'string' as const, description: 'Campaign ID to list ad groups for' },
      status: {
        type: 'string' as const,
        enum: ['ENABLED', 'PAUSED', 'REMOVED'],
        description: 'Filter by status',
      },
    },
    required: ['campaignId'],
  },
};
