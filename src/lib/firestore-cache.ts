/**
 * Firestore Cache Utilities
 *
 * Caching layer for video analysis results using Firestore with TTL expiration.
 * Reused from Meta Ads MCP.
 */

import { FieldValue, Timestamp } from '@google-cloud/firestore';
import { firestore } from './gcp-clients.js';
import { env } from '../config/env.js';

const COLLECTION_NAME = 'google_ads_video_analysis_cache';

export interface CacheEntry {
  videoId: string;
  analysisResults: any;
  gcsPath: string;
  expiresAt: Date;
  hitCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export async function getCached(videoId: string): Promise<CacheEntry | null> {
  if (!firestore) return null;

  try {
    const docRef = firestore.collection(COLLECTION_NAME).doc(videoId);
    const snap = await docRef.get();

    if (!snap.exists) return null;

    const data = snap.data();
    if (!data) return null;

    const expiresAt = data.expiresAt.toDate();
    const now = new Date();

    if (now > expiresAt) {
      await docRef.delete().catch((err) => {
        console.warn(`Failed to delete expired cache entry ${videoId}:`, err.message);
      });
      return null;
    }

    await docRef.update({
      hitCount: FieldValue.increment(1),
      updatedAt: Timestamp.fromDate(now),
    }).catch((err) => {
      console.warn(`Failed to update cache hit count for ${videoId}:`, err.message);
    });

    return {
      videoId: data.videoId,
      analysisResults: data.analysisResults,
      gcsPath: data.gcsPath,
      expiresAt: data.expiresAt.toDate(),
      hitCount: data.hitCount + 1,
      createdAt: data.createdAt.toDate(),
      updatedAt: now,
    };
  } catch (error) {
    console.warn(`Cache read failed for ${videoId}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

export async function setCached(
  entry: Omit<CacheEntry, 'hitCount' | 'createdAt' | 'updatedAt' | 'expiresAt'>
): Promise<void> {
  if (!firestore) {
    throw new Error('Firestore not initialized. Cannot set cache entry.');
  }

  try {
    const now = new Date();
    const ttlHours = env.FIRESTORE_CACHE_TTL_HOURS;
    const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);

    const fullEntry = {
      videoId: entry.videoId,
      analysisResults: entry.analysisResults,
      gcsPath: entry.gcsPath,
      hitCount: 0,
      createdAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now),
      expiresAt: Timestamp.fromDate(expiresAt),
    };

    await firestore.collection(COLLECTION_NAME).doc(entry.videoId).set(fullEntry);
    console.log(`Cached video analysis for ${entry.videoId} (expires in ${ttlHours}h)`);
  } catch (error) {
    console.warn(`Cache write failed for ${entry.videoId}:`, error instanceof Error ? error.message : error);
  }
}

export async function clearExpired(): Promise<number> {
  if (!firestore) return 0;

  try {
    const now = Timestamp.fromDate(new Date());
    const snapshot = await firestore
      .collection(COLLECTION_NAME)
      .where('expiresAt', '<', now)
      .limit(500)
      .get();

    if (snapshot.empty) return 0;

    const batch = firestore.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    console.log(`Cleared ${snapshot.size} expired cache entries`);
    return snapshot.size;
  } catch (error) {
    console.warn('Failed to clear expired cache entries:', error instanceof Error ? error.message : error);
    return 0;
  }
}
