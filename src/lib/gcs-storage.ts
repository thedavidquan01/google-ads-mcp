/**
 * Google Cloud Storage - Video Upload
 *
 * Utilities for streaming video uploads to GCS.
 * Reused from Meta Ads MCP.
 */

import { Bucket } from '@google-cloud/storage';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { storage, isGcpEnabled } from './gcp-clients.js';
import { env } from '../config/env.js';

export async function ensureBucket(): Promise<Bucket> {
  if (!storage) {
    throw new Error('GCS storage client not initialized. Please configure GOOGLE_SERVICE_ACCOUNT_JSON.');
  }

  const bucketName = env.GCS_BUCKET_NAME;
  const bucket = storage.bucket(bucketName);

  try {
    const [exists] = await bucket.exists();
    if (!exists) {
      console.log(`Creating GCS bucket: ${bucketName}`);
      await storage.createBucket(bucketName, {
        location: 'us-central1',
        storageClass: 'STANDARD',
      });
      console.log(`Bucket ${bucketName} created successfully`);
    }
    return bucket;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure bucket exists: ${message}`);
  }
}

export async function uploadVideo(
  videoStream: Readable,
  videoId: string,
  options?: {
    contentType?: string;
    metadata?: Record<string, string>;
  }
): Promise<string> {
  if (!storage) {
    throw new Error('GCS storage client not initialized.');
  }

  try {
    const bucket = await ensureBucket();

    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    const timestamp = Date.now();

    const gcsPath = `videos/raw/${year}/${month}/${day}/${videoId}_${timestamp}.mp4`;

    const file = bucket.file(gcsPath);
    const writeStream = file.createWriteStream({
      resumable: true,
      validation: 'crc32c',
      metadata: {
        contentType: options?.contentType || 'video/mp4',
        metadata: {
          videoId,
          uploadedAt: now.toISOString(),
          uploadedBy: 'google-ads-mcp-server',
          ...options?.metadata,
        },
      },
    });

    await pipeline(videoStream, writeStream);

    console.log(`Video uploaded successfully: ${gcsPath}`);
    return gcsPath;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to upload video (videoId: ${videoId}): ${message}`);
  }
}

export { isGcpEnabled };
