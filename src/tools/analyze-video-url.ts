/**
 * Analyze Video URL Tool
 *
 * Download a video from any URL, upload to GCS, and analyze with Gemini AI.
 * Platform-agnostic — works with any direct video URL.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { isGcpEnabled, uploadVideo } from '../lib/gcs-storage.js';
import { analyzeVideoWithCostGuard } from '../lib/gemini-analyzer.js';
import { isGeminiEnabled } from '../lib/gemini-client.js';
import axios from 'axios';
import { Readable } from 'stream';

const AnalyzeVideoUrlSchema = z.object({
  videoUrl: z.string().url().describe('Direct URL to a video file'),
  title: z.string().optional().describe('Optional title for the video'),
});

export async function analyzeVideoUrl(input: unknown): Promise<string> {
  const args = AnalyzeVideoUrlSchema.parse(input);

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
    console.log(`[analyze-video-url] Downloading from: ${args.videoUrl}`);

    const response = await axios.get(args.videoUrl, {
      responseType: 'stream',
      timeout: 120000,
      maxContentLength: 500 * 1024 * 1024, // 500MB limit
    });

    const videoId = `url_${Date.now()}`;
    const contentType = response.headers['content-type'] || 'video/mp4';

    const gcsPath = await uploadVideo(response.data as Readable, videoId, {
      contentType,
      metadata: {
        sourceUrl: args.videoUrl,
        title: args.title || 'Untitled',
      },
    });

    console.log(`[analyze-video-url] Uploaded to GCS: ${gcsPath}`);

    const estimatedDuration = 60;
    const analysis = await analyzeVideoWithCostGuard(gcsPath, estimatedDuration);

    console.log(`[analyze-video-url] Analysis complete: ${analysis.scenes.length} scenes`);

    return JSON.stringify({
      gcsPath,
      analysis,
      metadata: {
        sourceUrl: args.videoUrl,
        title: args.title || 'Untitled',
        estimatedDuration,
      },
    }, null, 2);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[analyze-video-url] Error: ${errorMessage}`);
    return JSON.stringify({
      error: `Failed to analyze video: ${errorMessage}`,
      sourceUrl: args.videoUrl,
    }, null, 2);
  }
}

export const analyzeVideoUrlTool: Tool = {
  name: 'analyze-video-url',
  description: 'Download a video from any URL, upload to GCS, and analyze with Gemini AI. Returns structured analysis including scenes, text overlays, emotional tone, and creative approach.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      videoUrl: {
        type: 'string' as const,
        description: 'Direct URL to a video file',
      },
      title: {
        type: 'string' as const,
        description: 'Optional title for the video',
      },
    },
    required: ['videoUrl'],
  },
};
