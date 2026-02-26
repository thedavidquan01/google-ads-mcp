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

/**
 * All available tools (15 total)
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

  // Search Keywords
  getKeywordPerformanceTool,

  // Campaign Management
  listCampaignsTool,
  listAdGroupsTool,
  getAdCreativeTextTool,
];
