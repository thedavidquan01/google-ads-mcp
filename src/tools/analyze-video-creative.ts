/**
 * Analyze Video Creative Tool
 *
 * Downloads a YouTube video ad by ID, uploads to GCS, and analyzes with Gemini AI.
 * Uses Firestore caching to avoid re-analyzing the same video.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getVideoDetails, extractVideoId } from '../services/youtube.js';
import { isGcpEnabled, uploadVideo } from '../lib/gcs-storage.js';
import { analyzeVideoWithCostGuard } from '../lib/gemini-analyzer.js';
import { isGeminiEnabled } from '../lib/gemini-client.js';
import { getCached, setCached } from '../lib/firestore-cache.js';
import axios from 'axios';
import { Readable } from 'stream';

const AnalyzeVideoCreativeSchema = z.object({
  videoId: z.string().describe('YouTube video ID or URL to analyze'),
});

export async function analyzeVideoCreative(args: unknown): Promise<string> {
  const input = AnalyzeVideoCreativeSchema.parse(args);

  const videoId = extractVideoId(input.videoId) || input.videoId;

  if (!isGcpEnabled) {
    return JSON.stringify({
      error: 'GCP not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON for video features.',
    }, null, 2);
  }

  if (!isGeminiEnabled()) {
    return JSON.stringify({
      error: 'Gemini AI not configured. Set GEMINI_API_KEY or configure Vertex AI.',
    }, null, 2);
  }

  try {
    // Check cache first
    const cached = await getCached(videoId);
    if (cached) {
      console.log(`[analyze-video-creative] Cache hit for ${videoId}`);
      return JSON.stringify({
        videoId,
        cached: true,
        analysis: cached.analysisResults,
        gcsPath: cached.gcsPath,
      }, null, 2);
    }

    // Get video metadata from YouTube
    const apiKey = process.env.GEMINI_API_KEY || process.env.YOUTUBE_API_KEY;
    let durationSeconds = 60; // Default fallback

    if (apiKey) {
      const details = await getVideoDetails(videoId, apiKey);
      if (details) {
        durationSeconds = details.durationSeconds;
        console.log(`[analyze-video-creative] Video: "${details.title}" (${durationSeconds}s)`);
      }
    }

    // Download video via yt-dlp or direct URL
    // For YouTube videos, we need to use a download approach
    // Using a YouTube download endpoint (requires yt-dlp on server)
    console.log(`[analyze-video-creative] Downloading YouTube video: ${videoId}`);

    // Attempt download using yt-dlp (must be installed on server)
    const { execSync } = await import('child_process');
    const { createReadStream } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    const { unlink } = await import('fs/promises');

    const tmpPath = join(tmpdir(), `yt-${videoId}-${Date.now()}.mp4`);

    try {
      execSync(
        `yt-dlp -f "best[ext=mp4]/best" -o "${tmpPath}" "https://www.youtube.com/watch?v=${videoId}" --no-playlist --quiet`,
        { timeout: 120000 }
      );
    } catch (dlError) {
      return JSON.stringify({
        error: `Failed to download YouTube video. yt-dlp may not be installed or video is unavailable.`,
        videoId,
        suggestion: 'Use analyze-video-url with a direct video file URL instead.',
      }, null, 2);
    }

    // Upload to GCS
    const videoStream = createReadStream(tmpPath);
    const gcsPath = await uploadVideo(videoStream as any, videoId, {
      metadata: { source: 'youtube', youtubeId: videoId },
    });

    // Clean up temp file
    try { await unlink(tmpPath); } catch {}

    console.log(`[analyze-video-creative] Uploaded to GCS: ${gcsPath}`);

    // Analyze with Gemini
    const analysis = await analyzeVideoWithCostGuard(gcsPath, durationSeconds);

    // Cache the result
    await setCached({
      videoId,
      analysisResults: analysis,
      gcsPath,
    });

    console.log(`[analyze-video-creative] Analysis complete: ${analysis.scenes.length} scenes`);

    return JSON.stringify({
      videoId,
      cached: false,
      analysis,
      gcsPath,
    }, null, 2);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[analyze-video-creative] Error: ${errorMessage}`);
    return JSON.stringify({
      error: `Failed to analyze video creative: ${errorMessage}`,
      videoId,
    }, null, 2);
  }
}

export const analyzeVideoCreativeTool: Tool = {
  name: 'analyze-video-creative',
  description: 'Download a YouTube video ad, upload to GCS, and analyze with Gemini AI. Returns structured analysis including scenes, text overlays, emotional tone, transcript, and creative approach. Results are cached for 24h.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      videoId: {
        type: 'string' as const,
        description: 'YouTube video ID or URL to analyze',
      },
    },
    required: ['videoId'],
  },
};
