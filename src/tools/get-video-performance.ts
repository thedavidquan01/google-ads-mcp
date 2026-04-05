/**
 * Get Video Performance Tool
 *
 * Query YouTube video ad metrics including views, CPV, view rate,
 * and quartile completion rates from Google Ads.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGaql } from '../services/google-ads.js';
import { dateRangeToGaql, buildGaqlQuery, type DateRange } from '../utils/gaql.js';
import { microsToAmount, calculateViewRate, calculateCpv, safeParseNumber } from '../utils/metrics.js';

const GetVideoPerformanceSchema = z.object({
  dateRange: z
    .enum(['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'])
    .default('last_7d'),
  campaignId: z.string().optional(),
  limit: z.number().int().positive().default(25),
});

export async function getVideoPerformance(args: unknown): Promise<string> {
  const input = GetVideoPerformanceSchema.parse(args);

  try {
    const where: string[] = [
      dateRangeToGaql(input.dateRange as DateRange),
      `campaign.advertising_channel_type = 'VIDEO'`,
      `campaign.status != 'REMOVED'`,
    ];

    if (input.campaignId) where.push(`campaign.id = ${input.campaignId}`);

    const query = buildGaqlQuery({
      select: [
        'video.id',
        'video.title',
        'video.channel_id',
        'video.duration_millis',
        'campaign.id',
        'campaign.name',
        'metrics.impressions',
        'metrics.video_views',
        'metrics.video_view_rate',
        'metrics.cost_micros',
        'metrics.average_cpv',
        'metrics.video_quartile_p25_rate',
        'metrics.video_quartile_p50_rate',
        'metrics.video_quartile_p75_rate',
        'metrics.video_quartile_p100_rate',
        'metrics.clicks',
        'metrics.conversions',
      ],
      from: 'video',
      where,
      orderBy: 'metrics.video_views DESC',
      limit: input.limit,
    });

    const results = await executeGaql(query);

    const videos = results.map((row: any) => {
      const video = row.video;
      const m = row.metrics;
      const impressions = safeParseNumber(m.impressions);
      const videoViews = safeParseNumber(m.video_views);
      const costMicros = safeParseNumber(m.cost_micros);

      return {
        videoId: video.id,
        videoUrl: `https://www.youtube.com/watch?v=${video.id}`,
        title: video.title,
        channelId: video.channel_id,
        durationMs: safeParseNumber(video.duration_millis),
        campaignId: row.campaign.id,
        campaignName: row.campaign.name,
        metrics: {
          impressions,
          videoViews,
          viewRate: safeParseNumber(m.video_view_rate),
          spend: microsToAmount(costMicros),
          averageCpv: microsToAmount(safeParseNumber(m.average_cpv)),
          clicks: safeParseNumber(m.clicks),
          conversions: safeParseNumber(m.conversions),
          quartile25: safeParseNumber(m.video_quartile_p25_rate),
          quartile50: safeParseNumber(m.video_quartile_p50_rate),
          quartile75: safeParseNumber(m.video_quartile_p75_rate),
          quartile100: safeParseNumber(m.video_quartile_p100_rate),
        },
      };
    });

    return JSON.stringify({
      dateRange: input.dateRange,
      videos,
    }, null, 2);
  } catch (error) {
    return `Error querying video performance: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export const getVideoPerformanceTool: Tool = {
  name: 'get-video-performance',
  description: 'Query YouTube video ad metrics including views, CPV, view rate, and quartile completion rates (25%, 50%, 75%, 100%) from Google Ads',
  inputSchema: {
    type: 'object' as const,
    properties: {
      dateRange: {
        type: 'string' as const,
        enum: ['last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'],
        default: 'last_7d',
      },
      campaignId: { type: 'string' as const, description: 'Filter by campaign ID' },
      limit: { type: 'number' as const, description: 'Max videos to return', default: 25 },
    },
  },
};
