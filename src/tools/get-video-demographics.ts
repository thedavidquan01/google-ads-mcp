/**
 * Get Video Demographics Tool
 *
 * Query video ad metrics broken down by age, gender, and device.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGaql } from '../services/google-ads.js';
import { dateRangeToGaql, buildGaqlQuery, type DateRange } from '../utils/gaql.js';
import { microsToAmount, safeParseNumber } from '../utils/metrics.js';

const GetVideoDemographicsSchema = z.object({
  dateRange: z
    .enum(['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'])
    .default('last_7d'),
  campaignId: z.string().optional(),
  segmentBy: z
    .enum(['age', 'gender', 'device'])
    .default('age')
    .describe('Dimension to segment by'),
});

export async function getVideoDemographics(args: unknown): Promise<string> {
  const input = GetVideoDemographicsSchema.parse(args);

  try {
    const where: string[] = [
      dateRangeToGaql(input.dateRange as DateRange),
      `campaign.advertising_channel_type = 'VIDEO'`,
      `campaign.status != 'REMOVED'`,
    ];

    if (input.campaignId) where.push(`campaign.id = ${input.campaignId}`);

    let segmentField: string;
    switch (input.segmentBy) {
      case 'age':
        segmentField = 'ad_group_criterion.age_range.type';
        break;
      case 'gender':
        segmentField = 'ad_group_criterion.gender.type';
        break;
      case 'device':
        segmentField = 'segments.device';
        break;
    }

    // For age/gender we query from gender_view or age_range_view
    // For device we use segments on campaign
    const fromResource = input.segmentBy === 'device' ? 'campaign' : `${input.segmentBy === 'age' ? 'age_range' : 'gender'}_view`;

    const selectFields = input.segmentBy === 'device'
      ? [
          'segments.device',
          'campaign.name',
          'metrics.impressions',
          'metrics.video_views',
          'metrics.cost_micros',
          'metrics.clicks',
          'metrics.conversions',
        ]
      : [
          segmentField,
          'campaign.name',
          'metrics.impressions',
          'metrics.video_views',
          'metrics.cost_micros',
          'metrics.clicks',
          'metrics.conversions',
        ];

    const query = buildGaqlQuery({
      select: selectFields,
      from: fromResource,
      where,
      orderBy: 'metrics.video_views DESC',
    });

    const results = await executeGaql(query);

    const segments = results.map((row: any) => {
      const m = row.metrics;
      let segmentValue: string;

      if (input.segmentBy === 'device') {
        segmentValue = row.segments?.device || 'UNKNOWN';
      } else if (input.segmentBy === 'age') {
        segmentValue = row.ad_group_criterion?.age_range?.type || 'UNKNOWN';
      } else {
        segmentValue = row.ad_group_criterion?.gender?.type || 'UNKNOWN';
      }

      return {
        segment: segmentValue,
        campaignName: row.campaign?.name,
        metrics: {
          impressions: safeParseNumber(m.impressions),
          videoViews: safeParseNumber(m.video_views),
          spend: microsToAmount(safeParseNumber(m.cost_micros)),
          clicks: safeParseNumber(m.clicks),
          conversions: safeParseNumber(m.conversions),
        },
      };
    });

    return JSON.stringify({
      dateRange: input.dateRange,
      segmentBy: input.segmentBy,
      segments,
    }, null, 2);
  } catch (error) {
    return `Error querying video demographics: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export const getVideoDemographicsTool: Tool = {
  name: 'get-video-demographics',
  description: 'Query YouTube video ad metrics segmented by age, gender, or device from Google Ads',
  inputSchema: {
    type: 'object' as const,
    properties: {
      dateRange: {
        type: 'string' as const,
        enum: ['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'],
        default: 'last_7d',
      },
      campaignId: { type: 'string' as const, description: 'Filter by campaign ID' },
      segmentBy: {
        type: 'string' as const,
        enum: ['age', 'gender', 'device'],
        description: 'Dimension to segment by',
        default: 'age',
      },
    },
  },
};
