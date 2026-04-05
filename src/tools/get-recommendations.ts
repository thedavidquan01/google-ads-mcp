/**
 * Get Recommendations Tool
 *
 * Query Google Ads optimization recommendations with estimated impact.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeGaql } from '../services/google-ads.js';
import { buildGaqlQuery } from '../utils/gaql.js';

const GetRecommendationsSchema = z.object({
  type: z
    .enum([
      'KEYWORD', 'TEXT_AD', 'CAMPAIGN_BUDGET', 'KEYWORD_MATCH_TYPE',
      'MOVE_UNUSED_BUDGET', 'TARGET_CPA_OPT_IN', 'TARGET_ROAS_OPT_IN',
      'RESPONSIVE_SEARCH_AD', 'ALL',
    ])
    .default('ALL')
    .describe('Filter by recommendation type'),
  limit: z.number().int().positive().default(50),
});

export async function getRecommendations(args: unknown): Promise<string> {
  const input = GetRecommendationsSchema.parse(args);

  try {
    const where: string[] = [
      `recommendation.dismissed = FALSE`,
    ];

    if (input.type !== 'ALL') {
      where.push(`recommendation.type = '${input.type}'`);
    }

    const query = buildGaqlQuery({
      select: [
        'recommendation.type',
        'recommendation.impact',
        'recommendation.campaign',
        'recommendation.ad_group',
        'recommendation.resource_name',
        'recommendation.keyword_recommendation',
        'recommendation.campaign_budget_recommendation',
        'recommendation.text_ad_recommendation',
        'recommendation.responsive_search_ad_recommendation',
        'recommendation.keyword_match_type_recommendation',
        'recommendation.target_cpa_opt_in_recommendation',
        'recommendation.target_roas_opt_in_recommendation',
        'recommendation.move_unused_budget_recommendation',
        'campaign.name',
        'campaign.id',
      ],
      from: 'recommendation',
      where,
      limit: input.limit,
    });

    const results = await executeGaql(query);

    const recommendations = results.map((row: any) => {
      const rec = row.recommendation || {};
      const impact = rec.impact?.base_metrics || {};

      // Extract type-specific recommendation details
      let details: any = null;
      if (rec.keyword_recommendation) {
        const kw = rec.keyword_recommendation;
        details = {
          keyword: kw.keyword?.text || null,
          matchType: kw.keyword?.match_type || null,
          recommendedCpcBidMicros: kw.recommended_cpc_bid_micros || null,
        };
      } else if (rec.campaign_budget_recommendation) {
        const br = rec.campaign_budget_recommendation;
        details = {
          currentBudgetAmountMicros: br.current_budget_amount_micros || null,
          recommendedBudgetAmountMicros: br.recommended_budget_amount_micros || null,
        };
      } else if (rec.text_ad_recommendation) {
        const ta = rec.text_ad_recommendation;
        details = { ad: ta.ad || null };
      } else if (rec.responsive_search_ad_recommendation) {
        const rsa = rec.responsive_search_ad_recommendation;
        details = { ad: rsa.ad || null };
      } else if (rec.keyword_match_type_recommendation) {
        const km = rec.keyword_match_type_recommendation;
        details = {
          keyword: km.keyword?.text || null,
          recommendedMatchType: km.recommended_match_type || null,
        };
      } else if (rec.target_cpa_opt_in_recommendation) {
        details = { targetCpaMicros: rec.target_cpa_opt_in_recommendation.recommended_target_cpa_micros || null };
      } else if (rec.target_roas_opt_in_recommendation) {
        details = { targetRoas: rec.target_roas_opt_in_recommendation.recommended_target_roas || null };
      } else if (rec.move_unused_budget_recommendation) {
        const mu = rec.move_unused_budget_recommendation;
        details = { excessBudgetMicros: mu.excess_campaign_budget || null };
      }

      return {
        type: rec.type,
        resourceName: rec.resource_name,
        campaignName: row.campaign?.name || null,
        campaignId: row.campaign?.id || null,
        details,
        estimatedImpact: {
          impressions: impact.impressions || null,
          clicks: impact.clicks || null,
          costMicros: impact.cost_micros || null,
          conversions: impact.conversions || null,
        },
      };
    });

    return JSON.stringify({
      type: input.type,
      totalRecommendations: recommendations.length,
      recommendations,
    }, null, 2);
  } catch (error) {
    return `Error querying recommendations: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export const getRecommendationsTool: Tool = {
  name: 'get-recommendations',
  description: 'Query Google Ads optimization recommendations with estimated impact on impressions, clicks, and conversions',
  inputSchema: {
    type: 'object' as const,
    properties: {
      type: {
        type: 'string' as const,
        enum: [
          'KEYWORD', 'TEXT_AD', 'CAMPAIGN_BUDGET', 'KEYWORD_MATCH_TYPE',
          'MOVE_UNUSED_BUDGET', 'TARGET_CPA_OPT_IN', 'TARGET_ROAS_OPT_IN',
          'RESPONSIVE_SEARCH_AD', 'ALL',
        ],
        description: 'Filter by recommendation type',
        default: 'ALL',
      },
      limit: { type: 'number' as const, description: 'Max recommendations to return', default: 50 },
    },
  },
};
