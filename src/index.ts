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
 * Initialize MCP server
 */
const server = new Server(
  {
    name: 'google-ads-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * Register tools/list handler
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

/**
 * Register tools/call handler
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
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

  // MCP transport
  const transport = new StreamableHTTPServerTransport();

  // Connect MCP server to transport
  await server.connect(transport);

  // MCP GET endpoint (SSE)
  app.get('/mcp', waitForReadiness, requireAuthForToolCall, async (req, res) => {
    console.log('[MCP] GET /mcp request received', {
      authenticated: !!req.user,
      userId: req.user?.userId,
    });

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
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error('[MCP] GET /mcp error:', error);
      if (!res.headersSent) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('session') || errorMessage.includes('Session')) {
          const baseUrl = `${req.protocol}://${req.get('host')}`;
          res.status(401).json({
            jsonrpc: '2.0',
            error: {
              code: -32001,
              message: 'Connection reset after server restart. Please restart Claude Code to reconnect.',
              data: {
                authentication: {
                  type: 'oauth2',
                  oauth_authorization_server: `${baseUrl}/.well-known/oauth-authorization-server`,
                },
              },
            },
            id: null,
          });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    } finally {
      if (connectionId) {
        mcpConnectionRegistry.unregister(connectionId);
      }
    }
  });

  // MCP POST endpoint (tool calls)
  const mcpBodyParser = express.text({ type: '*/*' });
  app.post('/mcp', mcpBodyParser, waitForReadiness, requireAuthForToolCall, async (req, res) => {
    let method = 'unknown';
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      method = body?.method || 'unknown';
    } catch (e) {}

    console.log('[MCP] POST /mcp request received', {
      authenticated: !!req.user,
      userId: req.user?.userId,
      method,
    });

    try {
      await transport.handleRequest(req, res, req.body);
      console.log('[MCP] POST /mcp response sent for method:', method);
    } catch (error) {
      console.error('[MCP] POST /mcp error:', error);
      if (!res.headersSent) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('session') || errorMessage.includes('Session')) {
          const baseUrl = `${req.protocol}://${req.get('host')}`;
          res.status(200).json({
            jsonrpc: '2.0',
            error: {
              code: -32001,
              message: 'Connection reset after server restart. Please restart Claude Code to reconnect.',
              data: {
                authentication: {
                  type: 'oauth2',
                  oauth_authorization_server: `${baseUrl}/.well-known/oauth-authorization-server`,
                },
              },
            },
            id: null,
          });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    }
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
