/**
 * Google Ads MCP Server
 *
 * Entry point for the Model Context Protocol server that provides
 * conversational access to Google Ads API and YouTube video analytics.
 *
 * Remote HTTP server with Google OAuth authentication.
 */

import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { env } from './config/env.js';
import { getSessionConfig } from './auth/session.js';
import { requireAuthForToolCall } from './middleware/auth.js';
import { waitForReadiness } from './middleware/readiness.js';
import authRoutes from './routes/auth.js';
import oauthRoutes from './routes/oauth.js';
import { AccessTokenStore } from './auth/device-flow.js';
import { storage, firestore, isGcpEnabled } from './lib/gcp-clients.js';
import { isGeminiEnabled, geminiConfig } from './lib/gemini-client.js';
import { ServerReadiness } from './lib/server-readiness.js';
import { tools } from './tools/index.js';

// Tool implementations
import { getAccountInfo } from './tools/get-account.js';
import { getCampaignPerformance } from './tools/get-campaign-performance.js';
import { getAdGroupPerformance } from './tools/get-adgroup-performance.js';
import { getAdPerformance } from './tools/get-ad-performance.js';
import { getVideoPerformance } from './tools/get-video-performance.js';
import { getVideoDemographics } from './tools/get-video-demographics.js';
import { compareTimePeriods } from './tools/compare-time-periods.js';
import { compareEntities } from './tools/compare-entities.js';
import { getYouTubeAdDetails } from './tools/get-youtube-ad-details.js';
import { analyzeVideoCreative } from './tools/analyze-video-creative.js';
import { analyzeVideoUrl } from './tools/analyze-video-url.js';
import { getKeywordPerformance } from './tools/get-keyword-performance.js';
import { listCampaigns } from './tools/list-campaigns.js';
import { listAdGroups } from './tools/list-ad-groups.js';
import { getAdCreativeText } from './tools/get-ad-creative-text.js';

/**
 * Create a fresh MCP server instance with all tool handlers registered.
 * Each session gets its own server to avoid "Server already initialized" errors.
 */
function createMCPServer(): Server {
  const mcpServer = new Server(
    { name: 'google-ads-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'get-account': {
          const result = await getAccountInfo(args as any);
          return { content: [{ type: 'text', text: result }] };
        }
        case 'get-campaign-performance': {
          const result = await getCampaignPerformance(args as any);
          return { content: [{ type: 'text', text: result }] };
        }
        case 'get-adgroup-performance': {
          const result = await getAdGroupPerformance(args as any);
          return { content: [{ type: 'text', text: result }] };
        }
        case 'get-ad-performance': {
          const result = await getAdPerformance(args as any);
          return { content: [{ type: 'text', text: result }] };
        }
        case 'get-video-performance': {
          const result = await getVideoPerformance(args as any);
          return { content: [{ type: 'text', text: result }] };
        }
        case 'get-video-demographics': {
          const result = await getVideoDemographics(args as any);
          return { content: [{ type: 'text', text: result }] };
        }
        case 'compare-time-periods': {
          const result = await compareTimePeriods(args as any);
          return { content: [{ type: 'text', text: result }] };
        }
        case 'compare-entities': {
          const result = await compareEntities(args as any);
          return { content: [{ type: 'text', text: result }] };
        }
        case 'get-youtube-ad-details': {
          const result = await getYouTubeAdDetails(args as any);
          return { content: [{ type: 'text', text: result }] };
        }
        case 'analyze-video-creative': {
          const result = await analyzeVideoCreative(args as any);
          return { content: [{ type: 'text', text: result }] };
        }
        case 'analyze-video-url': {
          const result = await analyzeVideoUrl(args as any);
          return { content: [{ type: 'text', text: result }] };
        }
        case 'get-keyword-performance': {
          const result = await getKeywordPerformance(args as any);
          return { content: [{ type: 'text', text: result }] };
        }
        case 'list-campaigns': {
          const result = await listCampaigns(args as any);
          return { content: [{ type: 'text', text: result }] };
        }
        case 'list-ad-groups': {
          const result = await listAdGroups(args as any);
          return { content: [{ type: 'text', text: result }] };
        }
        case 'get-ad-creative-text': {
          const result = await getAdCreativeText(args as any);
          return { content: [{ type: 'text', text: result }] };
        }
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{ type: 'text', text: `Error: ${errorMessage}` }],
        isError: true,
      };
    }
  });

  return mcpServer;
}

/**
 * Per-session transport map.
 * Each MCP session gets its own Server + StreamableHTTPServerTransport pair
 * to avoid "Stateless transport cannot be reused" and "Server already initialized" errors.
 */
const sessions = new Map<string, {
  transport: StreamableHTTPServerTransport;
  server: Server;
  createdAt: number;
}>();

// Sweep sessions older than 30 minutes to prevent memory leaks
const SESSION_MAX_AGE_MS = 30 * 60 * 1000;
setInterval(() => {
  for (const [id, entry] of sessions) {
    if (Date.now() - entry.createdAt > SESSION_MAX_AGE_MS) {
      console.log(`[MCP] Cleaning up stale session: ${id}`);
      try { entry.transport.close?.(); } catch {}
      try { entry.server.close(); } catch {}
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

/**
 * Initialize access token store
 */
const accessTokenStore = new AccessTokenStore();
global.accessTokenStore = accessTokenStore;

/**
 * Initialize server readiness manager
 */
const serverReadiness = new ServerReadiness();
global.serverReadiness = serverReadiness;

/**
 * Start MCP server with HTTP transport and OAuth authentication
 */
async function main() {
  // Initialize connection registry
  const { MCPConnectionRegistry } = await import('./mcp/connection-registry.js');
  const mcpConnectionRegistry = new MCPConnectionRegistry();
  global.mcpConnectionRegistry = mcpConnectionRegistry;

  // Load persisted tokens from Firestore
  console.log('[Startup] Loading persisted access tokens from Firestore...');
  await accessTokenStore.loadFromFirestore();
  console.log('[Startup] Access tokens loaded');

  const app = express();

  // Trust reverse proxy for secure cookies
  if (env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  // CORS configuration
  app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS', 'DELETE'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Cookie',
      'Accept',
      'Mcp-Session-Id',
      'MCP-Protocol-Version',
      'Last-Event-ID',
    ],
    exposedHeaders: [
      'Content-Type',
      'Mcp-Session-Id',
    ],
  }));

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(session(getSessionConfig()));

  // MCP Server metadata endpoint
  app.get('/mcp-metadata', (_req, res) => {
    res.json({
      name: 'google-ads',
      displayName: 'Google Ads Analytics',
      description: 'Access Google Ads API for campaign analytics, YouTube video metrics, and AI-powered video analysis',
      version: '0.1.0',
      transport: 'http',
      url: `${env.NODE_ENV === 'production' ? 'https://sp-google-ads-mcp.fly.dev' : 'http://localhost:3000'}/mcp`,
      authentication: {
        type: 'oauth',
        provider: 'google',
        automatic: true,
      },
      capabilities: [
        'Campaign performance analytics',
        'Ad group and ad-level metrics',
        'YouTube video performance metrics',
        'Video quartile completion tracking',
        'AI-powered video creative analysis (Gemini)',
        'Search keyword performance',
        'Period-over-period comparison',
        'Audience demographics breakdown',
      ],
    });
  });

  // Health check endpoint
  app.get('/health', async (_req, res) => {
    const readinessStatus = serverReadiness.getStatus();
    const healthResponse: any = {
      status: readinessStatus.state === 'ready' ? 'ok' : readinessStatus.state,
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      readiness: readinessStatus,
      gcs: {},
      firestore: {},
      gemini: {},
    };

    if (!isGcpEnabled) {
      healthResponse.gcs = { enabled: false, reason: 'No credentials configured' };
      healthResponse.firestore = { enabled: false, reason: 'No credentials configured' };
    } else {
      try {
        const bucket = storage!.bucket(env.GCS_BUCKET_NAME);
        const [exists] = await bucket.exists();
        healthResponse.gcs = { enabled: true, bucket: env.GCS_BUCKET_NAME, exists };
      } catch (error) {
        healthResponse.gcs = { enabled: true, bucket: env.GCS_BUCKET_NAME, error: (error as Error).message };
      }

      try {
        await firestore!.collection('google_ads_video_analysis_cache').limit(1).get();
        healthResponse.firestore = { enabled: true, accessible: true };
      } catch (error) {
        healthResponse.firestore = { enabled: true, error: (error as Error).message };
      }
    }

    if (!isGeminiEnabled()) {
      healthResponse.gemini = {
        enabled: false,
        reason: env.GEMINI_USE_VERTEX_AI
          ? 'Vertex AI mode but GCP not configured'
          : 'GEMINI_API_KEY not configured',
      };
    } else {
      healthResponse.gemini = {
        enabled: true,
        mode: geminiConfig.useVertexAI ? 'vertex-ai' : 'api-key',
        model: geminiConfig.model,
        maxCostPerAnalysis: env.GEMINI_MAX_COST_PER_ANALYSIS,
        accessible: true,
      };
    }

    res.json(healthResponse);
  });

  // OAuth routes
  app.use(oauthRoutes);

  // Auth routes
  app.use('/auth', authRoutes);

  // MCP POST endpoint — route by session
  const mcpBodyParser = express.text({ type: '*/*' });
  app.post('/mcp', mcpBodyParser, waitForReadiness, requireAuthForToolCall, async (req, res) => {
    let body: any;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch {
      res.status(400).json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
      return;
    }

    const method = body?.method || 'unknown';
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    console.log('[MCP] POST /mcp request received', {
      authenticated: !!req.user,
      userId: req.user?.userId,
      method,
      sessionId: sessionId ?? '(none)',
    });

    try {
      if (method === 'initialize') {
        // New session: create fresh server + transport pair
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });
        const mcpServer = createMCPServer();
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, req.body);

        const newSessionId = transport.sessionId;
        if (newSessionId) {
          sessions.set(newSessionId, { transport, server: mcpServer, createdAt: Date.now() });
          console.log(`[MCP] New session created: ${newSessionId} (total: ${sessions.size})`);
        }
      } else if (sessionId && sessions.has(sessionId)) {
        // Existing session: delegate to its transport
        const entry = sessions.get(sessionId)!;
        await entry.transport.handleRequest(req, res, req.body);
        console.log('[MCP] POST /mcp response sent for method:', method);
      } else {
        res.status(404).json({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Session not found. Please reinitialize.' },
          id: body?.id ?? null,
        });
      }
    } catch (error) {
      console.error('[MCP] POST /mcp error:', error);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: body?.id ?? null });
      }
    }
  });

  // MCP GET endpoint (SSE) — look up session by header
  app.get('/mcp', waitForReadiness, requireAuthForToolCall, async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    console.log('[MCP] GET /mcp request received', {
      authenticated: !!req.user,
      userId: req.user?.userId,
      sessionId: sessionId ?? '(none)',
    });

    if (!sessionId || !sessions.has(sessionId)) {
      res.status(404).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Session not found. Please reinitialize.' },
        id: null,
      });
      return;
    }

    const entry = sessions.get(sessionId)!;

    let connectionId: string | undefined;
    if (req.user) {
      connectionId = mcpConnectionRegistry.register(req.user.userId, res);
      console.log('[MCP] SSE connection registered:', connectionId);
    }

    req.on('close', () => {
      if (connectionId) {
        mcpConnectionRegistry.unregister(connectionId);
        console.log('[MCP] SSE connection closed:', connectionId);
      }
    });

    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    try {
      await entry.transport.handleRequest(req, res);
    } catch (error) {
      console.error('[MCP] GET /mcp error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    } finally {
      if (connectionId) {
        mcpConnectionRegistry.unregister(connectionId);
      }
    }
  });

  // MCP DELETE endpoint — clean up sessions
  app.delete('/mcp', (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && sessions.has(sessionId)) {
      const entry = sessions.get(sessionId)!;
      console.log(`[MCP] Deleting session: ${sessionId}`);
      try { entry.transport.close?.(); } catch {}
      try { entry.server.close(); } catch {}
      sessions.delete(sessionId);
    }
    res.status(200).end();
  });

  // Start HTTP server
  const PORT = env.PORT;
  const HOST = env.HOST;

  const httpServer = app.listen(PORT, HOST, () => {
    console.error(`Google Ads MCP server running on http://${HOST}:${PORT}`);
    console.error(`Health check: http://${HOST}:${PORT}/health`);
    console.error(`OAuth: http://${HOST}:${PORT}/authorize`);
    console.error(`Environment: ${env.NODE_ENV}`);
    console.error(`Readiness: ${serverReadiness.getStatus().state}`);
  });

  // Graceful shutdown handler
  let isShuttingDown = false;

  process.on('SIGTERM', async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.error('[Shutdown] SIGTERM received, starting graceful shutdown...');

    httpServer.close(() => {
      console.error('[Shutdown] HTTP server closed');
    });

    const connections = mcpConnectionRegistry.getConnectionCount();
    console.error(`[Shutdown] Draining ${connections} active connections...`);

    try {
      mcpConnectionRegistry.notifyRedeployment();
    } catch (error) {
      console.error('[Shutdown] Error notifying clients:', error);
    }

    const DRAIN_TIMEOUT = 20000;
    await new Promise(resolve => setTimeout(resolve, DRAIN_TIMEOUT));

    console.error('[Shutdown] Forcing remaining connections closed');
    mcpConnectionRegistry.closeAll();
    accessTokenStore.destroy();

    // Clean up all MCP sessions
    for (const [id, entry] of sessions) {
      try { entry.transport.close?.(); } catch {}
      try { entry.server.close(); } catch {}
      sessions.delete(id);
    }

    console.error('[Shutdown] Graceful shutdown complete');
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.error('[Shutdown] SIGINT received');
    process.kill(process.pid, 'SIGTERM');
  });
}

main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
