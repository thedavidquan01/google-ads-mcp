/**
 * Server Readiness Manager
 *
 * Tracks server startup state and blocks requests until critical resources are loaded.
 * Reused from Meta Ads MCP.
 */

export type ReadinessState = 'starting' | 'ready' | 'degraded';

interface ReadinessStatus {
  state: ReadinessState;
  tokenLoadStartedAt?: Date;
  tokenLoadCompletedAt?: Date;
  tokenCount?: number;
  tokenLoadDurationMs?: number;
  error?: string;
}

export class ServerReadiness {
  private state: ReadinessState = 'starting';
  private tokenLoadStartedAt?: Date;
  private tokenLoadCompletedAt?: Date;
  private tokenCount?: number;
  private error?: string;
  private readyPromise?: Promise<ReadinessState>;
  private readyResolve?: (state: ReadinessState) => void;

  constructor() {
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });
  }

  startTokenLoad(): void {
    this.tokenLoadStartedAt = new Date();
    console.log('[ServerReadiness] Token loading started');
  }

  completeTokenLoad(count: number, error?: Error): void {
    this.tokenLoadCompletedAt = new Date();
    this.tokenCount = count;

    if (error) {
      this.error = error.message;
      this.state = 'degraded';
      console.error('[ServerReadiness] Token loading failed:', error.message);
    } else {
      this.state = 'ready';
      const durationMs = this.tokenLoadStartedAt
        ? this.tokenLoadCompletedAt.getTime() - this.tokenLoadStartedAt.getTime()
        : 0;
      console.log(`[ServerReadiness] Token loading complete: ${count} tokens in ${durationMs}ms`);
    }

    if (this.readyResolve) {
      this.readyResolve(this.state);
    }
  }

  isReady(): boolean {
    return this.state === 'ready' || this.state === 'degraded';
  }

  async waitUntilReady(timeoutMs: number = 10000): Promise<ReadinessState> {
    if (this.isReady()) return this.state;

    const timeoutPromise = new Promise<ReadinessState>((resolve) => {
      setTimeout(() => {
        console.warn(`[ServerReadiness] Timeout after ${timeoutMs}ms - proceeding in degraded state`);
        this.state = 'degraded';
        resolve('degraded');
      }, timeoutMs);
    });

    return Promise.race([this.readyPromise!, timeoutPromise]);
  }

  getStatus(): ReadinessStatus {
    const status: ReadinessStatus = { state: this.state };
    if (this.tokenLoadStartedAt) status.tokenLoadStartedAt = this.tokenLoadStartedAt;
    if (this.tokenLoadCompletedAt) {
      status.tokenLoadCompletedAt = this.tokenLoadCompletedAt;
      status.tokenCount = this.tokenCount;
      if (this.tokenLoadStartedAt) {
        status.tokenLoadDurationMs = this.tokenLoadCompletedAt.getTime() - this.tokenLoadStartedAt.getTime();
      }
    }
    if (this.error) status.error = this.error;
    return status;
  }

  reset(): void {
    this.state = 'starting';
    this.tokenLoadStartedAt = undefined;
    this.tokenLoadCompletedAt = undefined;
    this.tokenCount = undefined;
    this.error = undefined;
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });
  }
}

declare global {
  var serverReadiness: ServerReadiness | undefined;
}
