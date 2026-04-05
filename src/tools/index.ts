/**
 * Tool Registry
 *
 * Central registry of all Google Ads MCP tools.
 * Exports tool definitions for MCP discovery and implementation functions for execution.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// Tool definitions
import { getAccountTool } from './get-account.js';
import { getCampaignPerformanceTool } from './get-campaign-performance.js';
import { getAdGroupPerformanceTool } from './get-adgroup-performance.js';
import { getAdPerformanceTool } from './get-ad-performance.js';
import { getVideoPerformanceTool } from './get-video-performance.js';
import { getVideoDemographicsTool } from './get-video-demographics.js';
import { compareTimePeriodsTool } from './compare-time-periods.js';
import { compareEntitiesTool } from './compare-entities.js';
import { getYouTubeAdDetailsTool } from './get-youtube-ad-details.js';
import { analyzeVideoCreativeTool } from './analyze-video-creative.js';
import { analyzeVideoUrlTool } from './analyze-video-url.js';
import { getKeywordPerformanceTool } from './get-keyword-performance.js';
import { listCampaignsTool } from './list-campaigns.js';
import { listAdGroupsTool } from './list-ad-groups.js';
import { getAdCreativeTextTool } from './get-ad-creative-text.js';
import { getSearchTermsTool } from './get-search-terms.js';
import { getKeywordIdeasTool } from './get-keyword-ideas.js';
import { getConversionActionsTool } from './get-conversion-actions.js';
import { getGenderPerformanceTool } from './get-gender-performance.js';
import { getAgePerformanceTool } from './get-age-performance.js';
import { getGeoPerformanceTool } from './get-geo-performance.js';
import { getAudiencePerformanceTool } from './get-audience-performance.js';
import { getAssetPerformanceTool } from './get-asset-performance.js';
import { getPlacementPerformanceTool } from './get-placement-performance.js';
import { getDevicePerformanceTool } from './get-device-performance.js';
import { getAdSchedulePerformanceTool } from './get-ad-schedule-performance.js';
import { getChangeHistoryTool } from './get-change-history.js';
import { getRecommendationsTool } from './get-recommendations.js';
import { getLandingPagePerformanceTool } from './get-landing-page-performance.js';
import { getBudgetInfoTool } from './get-budget-info.js';
import { getShoppingPerformanceTool } from './get-shopping-performance.js';
import { getAdExtensionPerformanceTool } from './get-ad-extension-performance.js';

/**
 * All available tools (32 total)
 */
export const tools: Tool[] = [
  // Core Analytics
  getAccountTool,
  getCampaignPerformanceTool,
  getAdGroupPerformanceTool,
  getAdPerformanceTool,
  getVideoPerformanceTool,
  getVideoDemographicsTool,

  // Comparison
  compareTimePeriodsTool,
  compareEntitiesTool,

  // YouTube + Gemini
  getYouTubeAdDetailsTool,
  analyzeVideoCreativeTool,
  analyzeVideoUrlTool,

  // Search Keywords & Terms
  getKeywordPerformanceTool,
  getSearchTermsTool,
  getKeywordIdeasTool,

  // Audience & Demographics
  getGenderPerformanceTool,
  getAgePerformanceTool,
  getGeoPerformanceTool,
  getAudiencePerformanceTool,
  getDevicePerformanceTool,

  // Creative & Assets
  getAssetPerformanceTool,
  getAdExtensionPerformanceTool,
  getPlacementPerformanceTool,

  // Conversion Tracking
  getConversionActionsTool,

  // Scheduling & Budget
  getAdSchedulePerformanceTool,
  getBudgetInfoTool,

  // Landing Pages
  getLandingPagePerformanceTool,

  // Shopping
  getShoppingPerformanceTool,

  // Account Management
  getChangeHistoryTool,
  getRecommendationsTool,
  listCampaignsTool,
  listAdGroupsTool,
  getAdCreativeTextTool,
];
