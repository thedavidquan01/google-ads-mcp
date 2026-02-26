import crypto from 'crypto';
import { firestore, isGcpEnabled } from '../lib/gcp-clients.js';

/**
 * Device code data structure for OAuth device flow
 */
export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: Date;
  interval: number;
  status: 'pending' | 'authorized' | 'denied' | 'expired';
  userId?: string;
  email?: string;
  name?: string;
  createdAt: Date;
}

/**
 * Access token data structure
 */
export interface AccessTokenData {
  userId: string;
  email: string;
  name: string;
  expiresAt: Date;
  deviceCode?: string;
  createdAt: Date;
}

/**
 * User data from OAuth callback
 */
export interface UserData {
  id: string;
  email: string;
  name: string;
}

const DEVICE_CODE_EXPIRY_MS = 15 * 60 * 1000;
const ACCESS_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000;
const POLLING_INTERVAL_SECONDS = 5;
const USER_CODE_LENGTH = 8;
const USER_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateDeviceCode(): string {
  return crypto.randomUUID();
}

export function generateUserCode(): string {
  const chars: string[] = [];
  for (let i = 0; i < USER_CODE_LENGTH; i++) {
    const randomIndex = crypto.randomInt(USER_CODE_CHARS.length);
    chars.push(USER_CODE_CHARS[randomIndex]);
  }
  const firstHalf = chars.slice(0, 4).join('');
  const secondHalf = chars.slice(4, 8).join('');
  return `${firstHalf}-${secondHalf}`;
}

export function generateAccessToken(): string {
  const randomBytes = crypto.randomBytes(32);
  return `mcp_${randomBytes.toString('hex')}`;
}

/**
 * In-memory store for device codes
 */
export class DeviceCodeStore {
  private codes: Map<string, DeviceCode> = new Map();
  private userCodeIndex: Map<string, string> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000);
  }

  create(verificationUri: string): DeviceCode {
    const deviceCode = generateDeviceCode();
    let userCode = generateUserCode();
    while (this.userCodeIndex.has(userCode)) {
      userCode = generateUserCode();
    }

    const code: DeviceCode = {
      deviceCode,
      userCode,
      verificationUri,
      expiresAt: new Date(Date.now() + DEVICE_CODE_EXPIRY_MS),
      interval: POLLING_INTERVAL_SECONDS,
      status: 'pending',
      createdAt: new Date(),
    };

    this.codes.set(deviceCode, code);
    this.userCodeIndex.set(userCode, deviceCode);
    return code;
  }

  getByDeviceCode(deviceCode: string): DeviceCode | undefined {
    const code = this.codes.get(deviceCode);
    if (!code) return undefined;
    if (new Date() > code.expiresAt) {
      code.status = 'expired';
      this.codes.set(deviceCode, code);
    }
    return code;
  }

  getByUserCode(userCode: string): DeviceCode | undefined {
    const deviceCode = this.userCodeIndex.get(userCode);
    if (!deviceCode) return undefined;
    return this.getByDeviceCode(deviceCode);
  }

  async authorize(deviceCode: string, userData: UserData): Promise<string> {
    const code = this.getByDeviceCode(deviceCode);
    if (!code) throw new Error('Invalid device code');
    if (code.status === 'expired') throw new Error('Device code has expired');
    if (code.status === 'authorized') throw new Error('Device code already used');

    code.status = 'authorized';
    code.userId = userData.id;
    code.email = userData.email;
    code.name = userData.name;
    this.codes.set(deviceCode, code);

    const accessToken = generateAccessToken();
    const tokenData: AccessTokenData = {
      userId: userData.id,
      email: userData.email,
      name: userData.name,
      expiresAt: new Date(Date.now() + ACCESS_TOKEN_EXPIRY_MS),
      deviceCode,
      createdAt: new Date(),
    };

    if (global.accessTokenStore) {
      await global.accessTokenStore.set(accessToken, tokenData);
    }

    if (global.mcpConnectionRegistry) {
      const terminatedCount = global.mcpConnectionRegistry.terminateByUserId(userData.id);
      console.log(`[Device Flow] Terminated ${terminatedCount} stale connections for user:`, userData.id);
    }

    return accessToken;
  }

  deny(deviceCode: string): void {
    const code = this.getByDeviceCode(deviceCode);
    if (code && code.status === 'pending') {
      code.status = 'denied';
      this.codes.set(deviceCode, code);
    }
  }

  cleanup(): void {
    const now = new Date();
    let cleanedCount = 0;
    for (const [deviceCode, code] of this.codes.entries()) {
      if (now > code.expiresAt || code.status === 'authorized') {
        this.codes.delete(deviceCode);
        this.userCodeIndex.delete(code.userCode);
        cleanedCount++;
      }
    }
    if (cleanedCount > 0) {
      console.log(`[DeviceCodeStore] Cleaned up ${cleanedCount} expired/used device codes`);
    }
  }

  getStats(): { total: number; pending: number; authorized: number; expired: number; denied: number } {
    const stats = { total: this.codes.size, pending: 0, authorized: 0, expired: 0, denied: 0 };
    for (const code of this.codes.values()) {
      stats[code.status]++;
    }
    return stats;
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.codes.clear();
    this.userCodeIndex.clear();
  }
}

/**
 * Persistent store for access tokens with Firestore backing
 */
export class AccessTokenStore {
  private tokens: Map<string, AccessTokenData> = new Map();
  private cleanupInterval: NodeJS.Timeout;
  private collectionName = 'access_tokens';
  private isFirestoreEnabled: boolean;

  constructor() {
    this.isFirestoreEnabled = isGcpEnabled;
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  async loadFromFirestore(): Promise<void> {
    if (!this.isFirestoreEnabled || !firestore) {
      console.log('[AccessTokenStore] Firestore not enabled, using in-memory only');
      global.serverReadiness?.completeTokenLoad(0);
      return;
    }

    global.serverReadiness?.startTokenLoad();

    try {
      const snapshot = await firestore.collection(this.collectionName).get();
      const now = new Date();
      let loadedCount = 0;
      let expiredCount = 0;
      const expiredTokens: string[] = [];

      for (const doc of snapshot.docs) {
        try {
          const data = doc.data();
          const token = doc.id;
          const expiresAt = data.expiresAt?.toDate() || new Date(data.expiresAt);
          const createdAt = data.createdAt?.toDate() || new Date(data.createdAt);

          if (now > expiresAt) {
            expiredCount++;
            expiredTokens.push(token);
            continue;
          }

          const tokenData: AccessTokenData = {
            userId: data.userId,
            email: data.email,
            name: data.name,
            expiresAt,
            deviceCode: data.deviceCode,
            createdAt,
          };

          if (!tokenData.userId || !tokenData.email || !tokenData.name) {
            console.error(`[AccessTokenStore] Invalid token data in Firestore: ${token}`);
            continue;
          }

          this.tokens.set(token, tokenData);
          loadedCount++;
        } catch (error) {
          console.error(`[AccessTokenStore] Failed to load token ${doc.id}:`, error);
        }
      }

      if (expiredTokens.length > 0) {
        const batch = firestore.batch();
        for (const token of expiredTokens) {
          batch.delete(firestore.collection(this.collectionName).doc(token));
        }
        await batch.commit();
        console.log(`[AccessTokenStore] Deleted ${expiredTokens.length} expired tokens from Firestore`);
      }

      console.log(`[AccessTokenStore] Loaded ${loadedCount} tokens from Firestore (cleaned ${expiredCount} expired)`);
      global.serverReadiness?.completeTokenLoad(loadedCount);
    } catch (error) {
      console.error('[AccessTokenStore] Failed to load from Firestore:', error);
      global.serverReadiness?.completeTokenLoad(0, error instanceof Error ? error : new Error(String(error)));
    }
  }

  async set(token: string, data: AccessTokenData): Promise<void> {
    this.tokens.set(token, data);

    if (this.isFirestoreEnabled && firestore) {
      try {
        const firestoreData: any = {
          userId: data.userId,
          email: data.email,
          name: data.name,
          expiresAt: data.expiresAt,
          createdAt: data.createdAt,
        };
        if (data.deviceCode !== undefined) {
          firestoreData.deviceCode = data.deviceCode;
        }
        await firestore.collection(this.collectionName).doc(token).set(firestoreData);
        console.log(`[AccessTokenStore] Persisted token to Firestore for user: ${data.email}`);
      } catch (error) {
        console.error('[AccessTokenStore] Failed to persist token to Firestore:', error);
      }
    }
  }

  validate(token: string): AccessTokenData | null {
    const data = this.tokens.get(token);
    if (!data) return null;
    if (new Date() > data.expiresAt) {
      this.tokens.delete(token);
      this.deleteFromFirestore(token);
      return null;
    }
    return data;
  }

  async revoke(token: string): Promise<boolean> {
    const deleted = this.tokens.delete(token);
    if (deleted && this.isFirestoreEnabled && firestore) {
      await this.deleteFromFirestore(token);
    }
    return deleted;
  }

  private async deleteFromFirestore(token: string): Promise<void> {
    if (!this.isFirestoreEnabled || !firestore) return;
    try {
      await firestore.collection(this.collectionName).doc(token).delete();
      console.log(`[AccessTokenStore] Deleted token from Firestore`);
    } catch (error) {
      console.error('[AccessTokenStore] Failed to delete token from Firestore:', error);
    }
  }

  async cleanup(): Promise<void> {
    const now = new Date();
    let cleanedCount = 0;
    const tokensToDelete: string[] = [];

    for (const [token, data] of this.tokens.entries()) {
      if (now > data.expiresAt) {
        this.tokens.delete(token);
        tokensToDelete.push(token);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`[AccessTokenStore] Cleaned up ${cleanedCount} expired access tokens from memory`);
    }

    if (tokensToDelete.length > 0 && this.isFirestoreEnabled && firestore) {
      try {
        const batch = firestore.batch();
        for (const token of tokensToDelete) {
          batch.delete(firestore.collection(this.collectionName).doc(token));
        }
        await batch.commit();
        console.log(`[AccessTokenStore] Cleaned up ${tokensToDelete.length} expired tokens from Firestore`);
      } catch (error) {
        console.error('[AccessTokenStore] Failed to clean up Firestore tokens:', error);
      }
    }
  }

  getStats(): { total: number; active: number } {
    const now = new Date();
    let active = 0;
    for (const data of this.tokens.values()) {
      if (now <= data.expiresAt) active++;
    }
    return { total: this.tokens.size, active };
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.tokens.clear();
  }
}

// Global declarations
declare global {
  var deviceCodeStore: DeviceCodeStore;
  var accessTokenStore: AccessTokenStore;
  var mcpConnectionRegistry: import('../mcp/connection-registry.js').MCPConnectionRegistry;
}
