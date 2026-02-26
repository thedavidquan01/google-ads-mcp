/**
 * Gemini Video Analysis Utilities
 *
 * Provides video ad content analysis using Gemini AI with structured JSON output.
 * Platform-agnostic — reused from Meta Ads MCP for YouTube video analysis.
 */

import { geminiClient, isGeminiEnabled, geminiConfig } from './gemini-client.js';
import { z } from 'zod';
import { env } from '../config/env.js';
import { storage } from './gcp-clients.js';
import pLimit from 'p-limit';

const uploadLimit = pLimit(1);
const analysisLimit = pLimit(env.GEMINI_MAX_CONCURRENT_ANALYSES);

/**
 * Video analysis schema
 */
const VideoAnalysisSchema = z.object({
  scenes: z.array(z.object({
    timestamp: z.string(),
    description: z.string(),
    shotType: z.string(),
    visualElements: z.array(z.string()),
  })),
  textOverlays: z.array(z.object({
    timestamp: z.string(),
    text: z.string(),
    purpose: z.enum(['headline', 'subheading', 'cta', 'disclaimer', 'pricing', 'other']),
  })),
  emotionalTone: z.string(),
  creativeApproach: z.string(),
  productPresentation: z.string(),
  callToAction: z.string(),
  targetAudienceIndicators: z.array(z.string()),
  keyMessages: z.array(z.string()),
  transcript: z.array(z.object({
    timestamp: z.string(),
    speaker: z.string(),
    text: z.string(),
  })).optional(),
  spokenTheme: z.string().optional(),
  spokenThemeDetails: z.object({
    primaryTheme: z.string(),
    secondaryThemes: z.array(z.string()),
    hookStatement: z.string(),
    spokenCta: z.string(),
    keySpokenMessages: z.array(z.string()),
  }).optional(),
});

export type VideoAnalysis = z.infer<typeof VideoAnalysisSchema>;

const geminiAnalysisSchema = {
  type: 'object',
  properties: {
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          timestamp: { type: 'string' },
          description: { type: 'string' },
          shotType: { type: 'string' },
          visualElements: { type: 'array', items: { type: 'string' } },
        },
        required: ['timestamp', 'description', 'shotType'],
      },
    },
    textOverlays: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          timestamp: { type: 'string' },
          text: { type: 'string' },
          purpose: { type: 'string', enum: ['headline', 'subheading', 'cta', 'disclaimer', 'pricing', 'other'] },
        },
        required: ['timestamp', 'text', 'purpose'],
      },
    },
    emotionalTone: { type: 'string' },
    creativeApproach: { type: 'string' },
    productPresentation: { type: 'string' },
    callToAction: { type: 'string' },
    targetAudienceIndicators: { type: 'array', items: { type: 'string' } },
    keyMessages: { type: 'array', items: { type: 'string' } },
    transcript: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          timestamp: { type: 'string' },
          speaker: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['timestamp', 'speaker', 'text'],
      },
    },
    spokenTheme: { type: 'string' },
    spokenThemeDetails: {
      type: 'object',
      properties: {
        primaryTheme: { type: 'string' },
        secondaryThemes: { type: 'array', items: { type: 'string' } },
        hookStatement: { type: 'string' },
        spokenCta: { type: 'string' },
        keySpokenMessages: { type: 'array', items: { type: 'string' } },
      },
      required: ['primaryTheme', 'secondaryThemes', 'hookStatement', 'spokenCta', 'keySpokenMessages'],
    },
  },
  required: ['scenes', 'textOverlays', 'emotionalTone', 'creativeApproach'],
};

const ANALYSIS_PROMPT = `Analyze this video advertisement comprehensively:

VISUAL ANALYSIS:
- Break down into distinct scenes with timestamps (MM:SS format)
- Identify shot types (close-up, wide shot, medium shot, etc.)
- Note key visual elements in each scene

TEXT ANALYSIS:
- Extract all text overlays with exact timestamps
- Identify purpose of each text element (headline, CTA, pricing, etc.)
- Note the exact text content

EMOTIONAL & CREATIVE ANALYSIS:
- Overall emotional tone (aspirational, humorous, urgent, educational, etc.)
- Creative approach (problem-solution, testimonial, lifestyle, product demo, etc.)
- Product presentation strategy
- Call-to-action elements and messaging
- Target audience indicators (age, lifestyle, interests)
- Key value propositions and messages

SPOKEN CONTENT ANALYSIS:
- Transcribe all spoken audio (voiceover, dialogue, on-screen speech) with timestamps (MM:SS)
- Identify speaker roles (narrator, voiceover, testimonial speaker, etc.)
- Identify the primary spoken messaging theme from: social-proof, urgency-scarcity, pain-agitate-solve, benefit-driven, storytelling, authority-expertise, comparison, question-hook, direct-offer
- Note secondary spoken themes
- Extract the opening hook statement (first words that grab attention)
- Extract the verbal call-to-action
- List key spoken value propositions (distinct from text overlay messages)
- If the video has no spoken audio, omit transcript and spokenTheme fields entirely

Format your response as structured JSON matching the schema provided.`;

interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
}

async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = { maxRetries: 3, baseDelayMs: 1000 }
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= options.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isRateLimit = errorMessage.includes('429') || errorMessage.includes('quota');
      const isServerError = errorMessage.includes('500') || errorMessage.includes('503');

      if (!isRateLimit && !isServerError) throw error;
      if (attempt === options.maxRetries) throw error;

      const delayMs = options.baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(`Retry attempt ${attempt}/${options.maxRetries} after ${delayMs}ms: ${errorMessage}`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError!;
}

function parseJsonResponse(responseText: string): any {
  let cleaned = responseText.trim();
  if (cleaned.startsWith('```')) {
    const lines = cleaned.split('\n');
    cleaned = lines.slice(1, -1).join('\n');
    if (cleaned.startsWith('json')) {
      cleaned = cleaned.substring(4).trim();
    }
  }
  return JSON.parse(cleaned);
}

async function analyzeVideoInternal(gcsPath: string): Promise<VideoAnalysis> {
  console.log(`Starting video analysis for: ${gcsPath}`);

  const bucket = storage!.bucket(env.GCS_BUCKET_NAME);
  const gcsFile = bucket.file(gcsPath);

  const { createWriteStream, createReadStream } = await import('fs');
  const { tmpdir } = await import('os');
  const { join } = await import('path');
  const { unlink } = await import('fs/promises');
  const { pipeline } = await import('stream/promises');

  const tmpPath = join(tmpdir(), `gemini-upload-${Date.now()}.mp4`);

  try {
    console.log(`Streaming video from GCS to temp file...`);
    await pipeline(gcsFile.createReadStream(), createWriteStream(tmpPath));

    const { stat } = await import('fs/promises');
    const fileStat = await stat(tmpPath);
    console.log(`Downloaded ${(fileStat.size / 1024 / 1024).toFixed(1)}MB to temp file for Gemini upload`);

    console.log(`Uploading to Gemini File API (queue position: ${uploadLimit.pendingCount + 1})...`);
    const uploadResult = await uploadLimit(async () => {
      const { readFile } = await import('fs/promises');
      return geminiClient!.files.upload({
        file: new Blob([await readFile(tmpPath)]),
        config: { mimeType: 'video/mp4' },
      });
    });

    console.log(`Gemini file uploaded: ${uploadResult.name}, state: ${uploadResult.state}`);

    let fileState = uploadResult;
    while (fileState.state === 'PROCESSING') {
      console.log('Waiting for Gemini to process video...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      fileState = await geminiClient!.files.get({ name: fileState.name! });
    }

    if (fileState.state === 'FAILED') {
      throw new Error(`Gemini file processing failed: ${fileState.name}`);
    }

    console.log(`Gemini file ready: ${fileState.uri}`);

    const response = await geminiClient!.models.generateContent({
      model: geminiConfig.model,
      contents: [
        {
          role: 'user',
          parts: [
            { fileData: { fileUri: fileState.uri!, mimeType: 'video/mp4' } },
            { text: ANALYSIS_PROMPT },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: geminiAnalysisSchema,
      },
    });

    const responseText = response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!responseText) throw new Error('No response text from Gemini API');

    console.log(`Received analysis response (${responseText.length} chars)`);

    const parsed = parseJsonResponse(responseText);
    const validated = VideoAnalysisSchema.parse(parsed);

    console.log(`Analysis completed: ${validated.scenes.length} scenes, ${validated.textOverlays.length} text overlays`);
    return validated;
  } finally {
    try { await (await import('fs/promises')).unlink(tmpPath); } catch {}
  }
}

export async function analyzeVideo(gcsPath: string): Promise<VideoAnalysis> {
  if (!isGeminiEnabled()) {
    throw new Error('Gemini client not initialized. Check GEMINI_API_KEY or Vertex AI setup.');
  }

  try {
    return await analysisLimit(() => retryWithBackoff(
      () => analyzeVideoInternal(gcsPath),
      { maxRetries: 3, baseDelayMs: 2000 }
    ));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('429') || errorMessage.includes('quota')) {
      console.error(`Rate limit hit for ${gcsPath}. Consider upgrading tier.`);
    } else if (errorMessage.includes('auth') || errorMessage.includes('permission')) {
      console.error(`Authentication failed for ${gcsPath}. Check credentials.`);
    } else {
      console.error(`Analysis failed for ${gcsPath}: ${errorMessage}`);
    }
    throw error;
  }
}

export function estimateAnalysisCost(videoDurationSeconds: number): number {
  const framesPerSecond = 1;
  const tokensPerFrame = 258;
  const inputTokens = videoDurationSeconds * framesPerSecond * tokensPerFrame;
  const outputTokens = 2000;

  const pricing = geminiConfig.model === 'gemini-2.5-flash'
    ? { input: 0.30, output: 2.50 }
    : { input: 1.25, output: 10.00 };

  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

export async function analyzeVideoWithCostGuard(
  gcsPath: string,
  videoDurationSeconds: number
): Promise<VideoAnalysis> {
  const estimatedCost = estimateAnalysisCost(videoDurationSeconds);

  if (estimatedCost > env.GEMINI_MAX_COST_PER_ANALYSIS) {
    throw new Error(
      `Estimated analysis cost ($${estimatedCost.toFixed(4)}) exceeds maximum ($${env.GEMINI_MAX_COST_PER_ANALYSIS}). ` +
      `Video duration: ${videoDurationSeconds}s.`
    );
  }

  console.log(`Estimated analysis cost: $${estimatedCost.toFixed(4)} for ${videoDurationSeconds}s video`);
  return analyzeVideo(gcsPath);
}

export { VideoAnalysisSchema };
