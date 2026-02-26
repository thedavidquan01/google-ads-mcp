/**
 * Get YouTube Ad Details Tool
 *
 * Fetches video metadata from YouTube Data API including title, duration, thumbnail.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getVideoDetails, extractVideoId } from '../services/youtube.js';

const GetYouTubeAdDetailsSchema = z.object({
  videoId: z
    .string()
    .describe('YouTube video ID or URL'),
});

export async function getYouTubeAdDetails(args: unknown): Promise<string> {
  const input = GetYouTubeAdDetailsSchema.parse(args);

  // Extract video ID from URL if needed
  const videoId = extractVideoId(input.videoId) || input.videoId;

  // Use Gemini API key as YouTube API key (both are Google Cloud API keys)
  const apiKey = process.env.GEMINI_API_KEY || process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return JSON.stringify({
      error: 'YouTube API key not configured. Set GEMINI_API_KEY or YOUTUBE_API_KEY.',
    }, null, 2);
  }

  try {
    const details = await getVideoDetails(videoId, apiKey);

    if (!details) {
      return JSON.stringify({
        error: `Video not found: ${videoId}`,
      }, null, 2);
    }

    return JSON.stringify(details, null, 2);
  } catch (error) {
    return `Error fetching YouTube video details: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export const getYouTubeAdDetailsTool: Tool = {
  name: 'get-youtube-ad-details',
  description: 'Get YouTube video metadata including title, duration, thumbnail URL, view count, and channel info. Accepts video ID or full YouTube URL.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      videoId: {
        type: 'string' as const,
        description: 'YouTube video ID or URL',
      },
    },
    required: ['videoId'],
  },
};
