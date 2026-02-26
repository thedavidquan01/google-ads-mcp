/**
 * Get Ad Creative Text Tool
 *
 * Extract headlines, descriptions, and other text from responsive ads.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGaql } from '../services/google-ads.js';
import { buildGaqlQuery, campaignStatusFilter } from '../utils/gaql.js';

const GetAdCreativeTextSchema = z.object({
  campaignId: z.string().optional(),
  adGroupId: z.string().optional(),
  adId: z.string().optional().describe('Specific ad ID'),
  limit: z.number().int().positive().default(20),
});

export async function getAdCreativeText(args: unknown): Promise<string> {
  const input = GetAdCreativeTextSchema.parse(args);

  try {
    const where: string[] = [
      campaignStatusFilter(),
      `ad_group_ad.status != 'REMOVED'`,
    ];

    if (input.campaignId) where.push(`campaign.id = ${input.campaignId}`);
    if (input.adGroupId) where.push(`ad_group.id = ${input.adGroupId}`);
    if (input.adId) where.push(`ad_group_ad.ad.id = ${input.adId}`);

    const query = buildGaqlQuery({
      select: [
        'ad_group_ad.ad.id',
        'ad_group_ad.ad.type',
        'ad_group_ad.ad.name',
        'ad_group_ad.ad.final_urls',
        'ad_group_ad.ad.responsive_search_ad.headlines',
        'ad_group_ad.ad.responsive_search_ad.descriptions',
        'ad_group_ad.ad.responsive_display_ad.headlines',
        'ad_group_ad.ad.responsive_display_ad.descriptions',
        'ad_group_ad.ad.responsive_display_ad.long_headline',
        'ad_group_ad.ad.video_ad.video.asset',
        'ad_group_ad.status',
        'campaign.name',
        'ad_group.name',
      ],
      from: 'ad_group_ad',
      where,
      limit: input.limit,
    });

    const results = await executeGaql(query);

    const ads = results.map((row: any) => {
      const ad = row.ad_group_ad.ad;
      const rsa = ad.responsive_search_ad;
      const rda = ad.responsive_display_ad;
      const videoAd = ad.video_ad;

      const creative: any = {
        adId: ad.id,
        adType: ad.type,
        adName: ad.name || 'Untitled',
        status: row.ad_group_ad.status,
        finalUrls: ad.final_urls || [],
        campaignName: row.campaign?.name,
        adGroupName: row.ad_group?.name,
      };

      // Responsive Search Ad
      if (rsa) {
        creative.headlines = (rsa.headlines || []).map((h: any) => h.text);
        creative.descriptions = (rsa.descriptions || []).map((d: any) => d.text);
      }

      // Responsive Display Ad
      if (rda) {
        creative.headlines = (rda.headlines || []).map((h: any) => h.text);
        creative.descriptions = (rda.descriptions || []).map((d: any) => d.text);
        if (rda.long_headline) {
          creative.longHeadline = rda.long_headline.text;
        }
      }

      // Video Ad
      if (videoAd) {
        creative.videoAsset = videoAd.video?.asset;
      }

      return creative;
    });

    return JSON.stringify({
      total: ads.length,
      ads,
    }, null, 2);
  } catch (error) {
    return `Error fetching ad creative text: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export const getAdCreativeTextTool: Tool = {
  name: 'get-ad-creative-text',
  description: 'Extract headlines, descriptions, and creative text from Google Ads (responsive search, display, and video ads)',
  inputSchema: {
    type: 'object' as const,
    properties: {
      campaignId: { type: 'string' as const, description: 'Filter by campaign ID' },
      adGroupId: { type: 'string' as const, description: 'Filter by ad group ID' },
      adId: { type: 'string' as const, description: 'Specific ad ID' },
      limit: { type: 'number' as const, default: 20 },
    },
  },
};
