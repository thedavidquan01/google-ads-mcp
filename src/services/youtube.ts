/**
 * YouTube Data API v3 Client
 *
 * Provides access to YouTube video metadata, thumbnails, and channel info.
 * Uses the same OAuth token as Google Ads (youtube.readonly scope).
 */

import axios from 'axios';

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

export interface YouTubeVideoDetails {
  id: string;
  url: string;
  title: string;
  description: string;
  duration: string;       // ISO 8601 (PT1M30S)
  durationSeconds: number;
  thumbnailUrl: string;
  channelTitle: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
}

/**
 * Parse ISO 8601 duration to seconds
 */
function parseDuration(iso8601: string): number {
  const match = iso8601.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Get video details from YouTube Data API
 *
 * @param videoId - YouTube video ID
 * @param apiKey - YouTube Data API key (or use OAuth token)
 */
export async function getVideoDetails(videoId: string, apiKey: string): Promise<YouTubeVideoDetails | null> {
  try {
    const response = await axios.get(`${YOUTUBE_API_BASE}/videos`, {
      params: {
        part: 'snippet,contentDetails,statistics',
        id: videoId,
        key: apiKey,
      },
    });

    const items = response.data.items;
    if (!items || items.length === 0) {
      return null;
    }

    const video = items[0];
    const snippet = video.snippet;
    const contentDetails = video.contentDetails;
    const statistics = video.statistics;

    return {
      id: video.id,
      url: `https://www.youtube.com/watch?v=${video.id}`,
      title: snippet.title,
      description: snippet.description,
      duration: contentDetails.duration,
      durationSeconds: parseDuration(contentDetails.duration),
      thumbnailUrl: snippet.thumbnails?.maxres?.url
        || snippet.thumbnails?.high?.url
        || snippet.thumbnails?.medium?.url
        || '',
      channelTitle: snippet.channelTitle,
      publishedAt: snippet.publishedAt,
      viewCount: parseInt(statistics.viewCount || '0', 10),
      likeCount: parseInt(statistics.likeCount || '0', 10),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[YouTube] Failed to get video details for ${videoId}: ${message}`);
    return null;
  }
}

/**
 * Extract YouTube video ID from various URL formats
 */
export function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([^&\s]+)/,
    /(?:youtu\.be\/)([^?\s]+)/,
    /(?:youtube\.com\/embed\/)([^?\s]+)/,
    /(?:youtube\.com\/v\/)([^?\s]+)/,
    /(?:youtube\.com\/shorts\/)([^?\s]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  // If it looks like a bare video ID (11 chars, alphanumeric + dash/underscore)
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
    return url;
  }

  return null;
}
