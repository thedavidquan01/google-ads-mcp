# Google Ads MCP Server

A Model Context Protocol (MCP) server that provides access to Google Ads API for comprehensive ad analytics with YouTube video analysis. Use the hosted instance with Claude Code in 30 seconds, or run your own.

**Live Instance:** `https://sp-google-ads-mcp.fly.dev/mcp`

## Features

### Core Analytics (v1.0)

- **Google OAuth Authentication**: Secure login with Google for multi-user access
- **Remote HTTP Access**: StreamableHTTP transport for remote MCP connections
- **Session Management**: 24-hour sessions with automatic expiry
- **16 Analytics Tools**: Comprehensive Google Ads + YouTube performance analytics
  - Account information
  - Campaign, Ad Group, and Ad performance metrics
  - Keyword performance tracking
  - Ad creative text extraction
  - YouTube video performance, demographics, and ad details
  - AI-powered video creative analysis (Gemini)
  - Time period and entity comparisons
- **Docker Support**: Containerized deployment with health checks
- **Production Ready**: Environment-based configuration, security best practices

### Video Interpretation

- **AI-Powered Creative Analysis**: Analyze YouTube video ad creative using Gemini AI
  - Scene-by-scene breakdown with visual elements
  - Text overlay detection and categorization
  - Emotional tone identification (aspirational, urgent, educational, etc.)
  - Creative approach classification (problem-solution, testimonial, lifestyle, etc.)
  - Key message extraction

- **Intelligent Caching**: Firestore-based result caching
  - Cache by video ID (same video across multiple ads)
  - Configurable TTL (default: 24 hours)
  - Automatic cost savings tracking

## Prerequisites

- Node.js 24+ (or Docker)
- Google Ads Developer Token ([apply here](https://developers.google.com/google-ads/api/docs/get-started/dev-token))
- Google Ads Customer ID (format: `123-456-7890`)
- Google OAuth 2.0 credentials (Client ID + Secret)

### Google Cloud Services (for Video Interpretation)

- **Google Cloud Storage**: Video file storage
- **Firestore**: Analysis result caching
- **Gemini API**: Video content analysis

## Quick Setup for Claude Code (5 Seconds)

**Easiest onboarding ever - just one command!**

### Method 1: One Command (Recommended)

```bash
claude mcp add google-ads --transport http https://sp-google-ads-mcp.fly.dev/mcp
```

That's it! Now try asking in Claude Code:
```
"Show me campaign performance for last 7 days"
```

Claude will automatically prompt you to authenticate with Google, and you're done!

---

### Method 2: Manual Configuration

If `claude mcp add` doesn't work, edit `~/.config/claude-code/mcp.json`:

```json
{
  "mcpServers": {
    "google-ads": {
      "url": "https://sp-google-ads-mcp.fly.dev/mcp",
      "transport": "http"
    }
  }
}
```

Then restart Claude Code and ask:
```
"Show me campaign performance for last 7 days"
```

Claude will automatically:
1. Prompt you to authenticate with Google
2. Handle the OAuth flow
3. Start querying your Google Ads data

**No manual OAuth setup, no cookies, no installation. Claude handles everything!**

---

### Onboarding Your Team

Share this link with your team: [ONBOARDING.md](./ONBOARDING.md)

Or send them this simple instruction:
```
Run: claude mcp add google-ads --transport http https://sp-google-ads-mcp.fly.dev/mcp
```

---

## Alternative: Run Locally

If you want to run your own instance (for development or customization):

```bash
# 1. Clone and setup
git clone https://github.com/superpower-growth/google-ads-mcp.git
cd google-ads-mcp
npm install

# 2. Copy and edit .env
cp .env.example .env
# Add your Google Ads credentials:
#   - GOOGLE_ADS_DEVELOPER_TOKEN
#   - GOOGLE_ADS_CUSTOMER_ID (format: 123-456-7890)
#   - GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET
#   - REQUIRE_AUTH=false (for local use)

# 3. Build and start
npm run build
npm start

# 4. Update Claude Code to use localhost:
# claude mcp add google-ads --transport http http://localhost:3000/mcp
```

## Available Tools

All tools are accessible via Claude Code once authenticated:

| # | Tool | Description | When to Use |
|---|------|-------------|-------------|
| 1 | **get-account** | Account info (currency, timezone, status) | Verify account access and settings |
| 2 | **get-campaign-performance** | Campaign-level metrics and performance | Weekly/daily performance pulls. Filter by `campaignType` (SEARCH, PMAX, VIDEO, DEMAND_GEN). Always request `conversion_value` and `roas` alongside defaults. |
| 3 | **get-adgroup-performance** | Ad Group-level performance data | Drill into which ad groups within a campaign are driving results |
| 4 | **get-ad-performance** | Individual ad performance (includes video quartile completion) | Find top/bottom performing individual ads |
| 5 | **get-keyword-performance** | Keyword-level performance, quality scores, impression share | Search campaign optimization — sort by spend, flag high-spend/low-conversion keywords |
| 6 | **get-ad-creative-text** | Extract headlines, descriptions, and copy from ads | Pull copy from responsive search, display, and video ads |
| 7 | **get-video-performance** | YouTube video views, CPV, view rate, quartile drop-off (25/50/75/100%) | Video ad retention analysis |
| 8 | **get-video-demographics** | Audience breakdowns segmented by `age`, `gender`, or `device` | Build audience profile (requires 3 calls for full picture) |
| 9 | **get-youtube-ad-details** | Video metadata (title, duration, thumbnail, view count) | Get context on a specific YouTube video ad |
| 10 | **analyze-video-creative** | AI analysis of YouTube video ads (scenes, overlays, tone, transcript) — cached 24h | Understand what's working in top-performing creatives |
| 11 | **analyze-video-url** | Same AI analysis but for any direct video URL | Analyze videos not hosted on YouTube |
| 12 | **compare-entities** | Side-by-side campaign or ad group comparison (2-10 entities, sortable) | A/B comparisons and competitive ranking |
| 13 | **compare-time-periods** | Auto-compares current vs prior period (e.g., last 7d vs prior 7d) | WoW or MoM trend analysis |
| 14 | **list-campaigns** | List all campaigns — filter by `status` (ENABLED/PAUSED) or `type` | Quick inventory of campaigns |
| 15 | **list-ad-groups** | List ad groups within a campaign | Explore campaign structure |

### Known Gotchas

- **`video_views` metric errors on campaign-level queries** — omit it from `get-campaign-performance` metrics array. Use `get-video-performance` for video metrics instead.
- **PMAX conversion value gaps** — PMAX campaigns may report high conversion counts (e.g., app installs) but $0 conversion value. This is a conversion value tracking gap, not a performance issue. Flag this when reporting.
- **Legacy paused campaigns** — Always filter out paused campaigns with $0 spend when presenting results. Accounts often have many inactive campaigns that clutter output.
- **Date ranges are presets only** — `last_7d`, `last_14d`, `last_30d`, `last_90d`, `this_month`, `last_month`. No custom date ranges supported.

### Recommended Workflows

1. **Weekly performance report**: `get-campaign-performance` (last_7d, all metrics) → filter to ENABLED campaigns with spend > $0 → present as table with totals
2. **Trend analysis**: `compare-time-periods` (last_7d) to get WoW deltas automatically
3. **Creative analysis**: `get-ad-performance` → identify top/bottom ads → `analyze-video-creative` on top performers to understand what's working
4. **Search optimization**: `get-keyword-performance` → sort by spend → flag high-spend/low-conversion keywords
5. **Audience insights**: `get-video-demographics` segmented by age, then gender, then device (3 calls) to build full audience picture

## Environment Variables

See `.env.example` for full documentation. Key variables:

### Google Ads API
- `GOOGLE_ADS_DEVELOPER_TOKEN` - Developer token from Google Ads API Center
- `GOOGLE_ADS_CUSTOMER_ID` - Customer ID (format: `123-456-7890`)
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID` - Optional: MCC ID if using a manager account

### Google OAuth 2.0
- `GOOGLE_CLIENT_ID` - OAuth client ID from Google Cloud Console
- `GOOGLE_CLIENT_SECRET` - OAuth client secret
- `GOOGLE_CALLBACK_URL` - OAuth redirect URI (default: `https://sp-google-ads-mcp.fly.dev/auth/callback`)

### Server
- `HOST` - Server bind address (default: `0.0.0.0`)
- `PORT` - Server port (default: `3000`)
- `NODE_ENV` - Environment mode (`development`, `production`)
- `REQUIRE_AUTH` - Authentication mode (default: `true`)
  - `false` - **Local mode**: Uses credentials directly, no OAuth needed
  - `true` - **Production mode**: Requires Google OAuth login
- `SESSION_SECRET` - Random secret for session signing (min 32 chars)

### Video Interpretation
- `GOOGLE_SERVICE_ACCOUNT_JSON` - Full JSON of GCP service account key
- `GCP_PROJECT_ID` - Google Cloud project ID
- `GCS_BUCKET_NAME` - Cloud Storage bucket for video files
- `FIRESTORE_CACHE_TTL_HOURS` - Cache duration (default: `24`)
- `GEMINI_API_KEY` - Gemini API key for video analysis
- `GEMINI_MODEL` - Model to use (default: `gemini-2.5-flash`)
- `GEMINI_MAX_COST_PER_ANALYSIS` - Cost cap per analysis (default: `0.10`)

## Production Deployment

### Fly.io (Current)

The live instance runs on Fly.io. To deploy your own:

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Launch (creates app from fly.toml)
fly launch

# Set secrets
fly secrets set GOOGLE_ADS_DEVELOPER_TOKEN=xxx
fly secrets set GOOGLE_ADS_CUSTOMER_ID=xxx
fly secrets set GOOGLE_CLIENT_ID=xxx
fly secrets set GOOGLE_CLIENT_SECRET=xxx
fly secrets set SESSION_SECRET=$(openssl rand -base64 32)
# ... set all required env vars

# Deploy
fly deploy
```

### Docker

```bash
# Build image
docker build -t google-ads-mcp .

# Run container
docker run -d \
  -p 3000:3000 \
  --env-file .env \
  --name google-ads-mcp \
  google-ads-mcp
```

## API Endpoints

### Public Endpoints

- `GET /health` - Health check (no auth required)
  ```bash
  curl https://sp-google-ads-mcp.fly.dev/health
  ```

### Authentication Endpoints

- `GET /auth/google` - Initiate OAuth login
- `GET /auth/callback` - OAuth callback handler
- `GET /auth/logout` - Destroy session
- `GET /auth/me` - Get current user info (requires auth)

### MCP Endpoints (Require Authentication)

- `GET /mcp` - SSE streaming endpoint
- `POST /mcp` - Request/response endpoint

## Troubleshooting

### "Session not found" or "Connection reset" after redeployment

**This is normal after server updates!** When the server redeploys, all active connections are reset.

**Solution:**
1. **Restart Claude Code** (close and reopen the application)
2. Try your query again
3. If prompted, re-authenticate with Google

### "Unauthorized" errors

1. Check your authentication is valid
2. If you just authenticated, restart Claude Code to refresh the connection
3. Sessions last 24 hours - re-authenticate if expired

### OAuth callback errors

1. Verify `GOOGLE_CALLBACK_URL` matches the URL in Google Cloud Console
2. Check `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are correct
3. Ensure OAuth consent screen has required scopes

### Google Ads API errors

1. Check that your Developer Token is approved (not test mode)
2. Verify `GOOGLE_ADS_CUSTOMER_ID` format is `123-456-7890`
3. Confirm you have access to the ad account
4. If using MCC, ensure `GOOGLE_ADS_LOGIN_CUSTOMER_ID` is set

### Token / quota errors

1. Google Ads API has rate limits - check your developer token tier
2. Refresh tokens are long-lived but can be revoked - re-authenticate if needed
3. Check Google Cloud Console for quota usage

## Development

```bash
# Install dependencies
npm install

# Type checking
npm run type-check

# Development mode with hot reload
npm run dev

# Build
npm run build

# Run built version
npm start

# Run tests
npm test
```

## Security Considerations

1. **HTTPS in Production**: Always use HTTPS in production environments
2. **Session Secret**: Use a strong, random 32+ character secret
3. **Environment Variables**: Never commit `.env` to version control
4. **User Isolation**: Each user has their own Google-authenticated session
5. **Token Security**: OAuth tokens are stored server-side, never exposed to clients

## License

MIT

---

**Built with the Model Context Protocol SDK**
