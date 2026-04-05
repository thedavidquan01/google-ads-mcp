/**
 * Get Keyword Ideas Tool
 *
 * Uses the Google Ads KeywordPlanIdeaService to generate keyword research data
 * including search volume, competition, and bid estimates.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCustomer } from '../services/google-ads.js';
import { microsToAmount } from '../utils/metrics.js';
import { enums } from 'google-ads-api';
import { env } from '../config/env.js';

const GetKeywordIdeasSchema = z.object({
  keywords: z
    .array(z.string())
    .min(1)
    .describe('Seed keywords to generate ideas from'),
  url: z
    .string()
    .optional()
    .describe('Seed URL to generate keyword ideas from (can be used with or without keywords)'),
  language: z
    .string()
    .default('1000')
    .describe('Language constant ID (default: 1000 = English). See Google Ads API language constants.'),
  geoTargets: z
    .array(z.string())
    .default(['2840'])
    .describe('Geo target constant IDs (default: ["2840"] = United States). See Google Ads API geo target constants.'),
  includeAdultKeywords: z
    .boolean()
    .default(false),
  limit: z.number().int().positive().default(50),
});

export async function getKeywordIdeas(args: unknown): Promise<string> {
  const input = GetKeywordIdeasSchema.parse(args);

  const customer = getCustomer();
  if (!customer) {
    throw new Error('Google Ads client not initialized. Check GOOGLE_ADS_DEVELOPER_TOKEN and OAuth configuration.');
  }

  try {
    const request: any = {
      customer_id: env.GOOGLE_ADS_CUSTOMER_ID,
      language: `languageConstants/${input.language}`,
      geo_target_constants: input.geoTargets.map((id) => `geoTargetConstants/${id}`),
      keyword_plan_network: enums.KeywordPlanNetwork.GOOGLE_SEARCH,
      include_adult_keywords: input.includeAdultKeywords,
    };

    // Set seed based on what's provided
    if (input.keywords && input.url) {
      request.keyword_and_url_seed = {
        keywords: input.keywords,
        url: input.url,
      };
    } else if (input.url) {
      request.url_seed = { url: input.url };
    } else {
      request.keyword_seed = { keywords: input.keywords };
    }

    const response = await customer.keywordPlanIdeas.generateKeywordIdeas(request);

    // The google-ads-api library may return results as an array directly,
    // or wrapped in { results: [...] }
    const rawResults = Array.isArray(response) ? response : (response.results || []);
    const results = rawResults.slice(0, input.limit).map((result: any) => {
      const metrics = result.keyword_idea_metrics || {};
      return {
        keyword: result.text,
        avgMonthlySearches: Number(metrics.avg_monthly_searches) || 0,
        competition: metrics.competition != null
          ? enums.KeywordPlanCompetitionLevel[metrics.competition] || metrics.competition
          : 'UNKNOWN',
        competitionIndex: Number(metrics.competition_index) || 0,
        lowTopOfPageBid: microsToAmount(Number(metrics.low_top_of_page_bid_micros) || 0),
        highTopOfPageBid: microsToAmount(Number(metrics.high_top_of_page_bid_micros) || 0),
      };
    });

    return JSON.stringify({
      seedKeywords: input.keywords,
      seedUrl: input.url || null,
      totalIdeas: results.length,
      ideas: results,
    }, null, 2);
  } catch (error) {
    let message: string;
    if (error instanceof Error) {
      message = error.message;
    } else if (error && typeof error === 'object') {
      const anyError = error as any;
      if (anyError.errors && Array.isArray(anyError.errors)) {
        message = anyError.errors
          .map((e: any) => e.message || e.error_code || JSON.stringify(e))
          .join('; ');
      } else {
        try {
          message = JSON.stringify(error);
        } catch {
          message = String(error);
        }
      }
    } else {
      message = String(error);
    }
    return `Error generating keyword ideas: ${message}`;
  }
}

export const getKeywordIdeasTool: Tool = {
  name: 'get-keyword-ideas',
  description:
    'Generate keyword research ideas with search volume, competition level, and bid estimates using Google Ads Keyword Planner. Provide seed keywords and/or a URL.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      keywords: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Seed keywords to generate ideas from',
      },
      url: {
        type: 'string' as const,
        description: 'Seed URL to generate keyword ideas from',
      },
      language: {
        type: 'string' as const,
        description: 'Language constant ID (default: 1000 = English)',
        default: '1000',
      },
      geoTargets: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'Geo target constant IDs (default: ["2840"] = United States)',
        default: ['2840'],
      },
      includeAdultKeywords: {
        type: 'boolean' as const,
        description: 'Include adult keywords in results',
        default: false,
      },
      limit: {
        type: 'number' as const,
        description: 'Max keyword ideas to return',
        default: 50,
      },
    },
    required: ['keywords'],
  },
};
