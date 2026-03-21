# Google Ads MCP Server

A Model Context Protocol (MCP) server that provides access to Google Ads API and YouTube video analytics with AI-powered creative analysis.

## Quick Start (Claude Code)

```bash
claude mcp add --transport http google-ads https://recime-google-ads-mcp.fly.dev/mcp
```

Then ask:
```
"Show me campaign performance for last 7 days"
```

Claude will prompt you to authenticate with Google automatically.

### Manual Configuration

Edit `~/.config/claude-code/mcp.json`:

```json
{
  "mcpServers": {
    "google-ads": {
      "url": "https://recime-google-ads-mcp.fly.dev/mcp",
      "transport": "http"
    }
  }
}
```

## Features

- **Google OAuth Authentication** with multi-user session isolation
- **15 MCP Tools** for campaign analytics, YouTube metrics, and AI video analysis
- **Gemini AI Video Analysis** with Firestore caching
- **StreamableHTTP Transport** with per-session MCP servers

## Available Tools (15)

### Performance Analytics
| Tool | Description |
|------|-------------|
| `get-account` | Account info (currency, timezone, status) |
| `get-campaign-performance` | Campaign metrics (impressions, clicks, spend, CTR, CPC, ROAS). Filter by `campaignType` (SEARCH, PMAX, VIDEO, DEMAND_GEN). Supports `segmentByDay`. |
| `get-adgroup-performance` | Ad group level metrics. Supports `segmentByDay`. |
| `get-ad-performance` | Individual ad metrics with video quartile completion. Supports `segmentByDay`. |
| `get-video-performance` | YouTube video views, CPV, view rate, quartile drop-off (25/50/75/100%) |
| `get-video-demographics` | Video audience breakdowns by age, gender, or device |
| `get-keyword-performance` | Search keyword metrics, quality scores, impression share. Supports `segmentByDay`. |

### Creative Analysis
| Tool | Description |
|------|-------------|
| `get-ad-creative-text` | Extract headlines, descriptions, and copy from ads |
| `get-youtube-ad-details` | YouTube video metadata (title, duration, thumbnail) |
| `analyze-video-creative` | Gemini AI scene-by-scene video analysis (cached 24h) |
| `analyze-video-url` | Analyze video from any direct URL |

### Comparisons
| Tool | Description |
|------|-------------|
| `compare-time-periods` | Period-over-period analysis (e.g., last 7d vs prior 7d) |
| `compare-entities` | Rank 2-10 campaigns/ad groups/ads side by side |

### Campaign Management
| Tool | Description |
|------|-------------|
| `list-campaigns` | List campaigns, filter by status or type |
| `list-ad-groups` | List ad groups within a campaign |

### Known Gotchas

- **`video_views` errors on campaign queries** — use `get-video-performance` for video metrics instead
- **PMAX conversion value gaps** — may report high counts but $0 value (tracking gap, not performance issue)
- **Date ranges are presets only** — `last_7d`, `last_14d`, `last_30d`, `last_90d`, `this_month`, `last_month`

## Run Locally

### Prerequisites

- Node.js 24+
- Google Ads Developer Token ([apply here](https://developers.google.com/google-ads/api/docs/get-started/dev-token))
- Google Ads Customer ID (format: `123-456-7890`)
- Google OAuth 2.0 credentials (Client ID + Secret)

Optional (for video analysis):
- Google Cloud Storage bucket
- Firestore database
- Gemini API key

### Setup

```bash
git clone https://github.com/team-recime/google-ads-mcp.git
cd google-ads-mcp
cp .env.example .env
# Edit .env with your credentials
npm install
npm run build
npm start
```

For local development without OAuth, set `REQUIRE_AUTH=false` in `.env`.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads API developer token |
| `GOOGLE_ADS_CUSTOMER_ID` | Customer ID (format: `123-456-7890`) |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Optional: MCC ID if using manager account |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_CALLBACK_URL` | OAuth redirect URI |
| `SESSION_SECRET` | Random 32+ char secret (`openssl rand -base64 32`) |
| `REQUIRE_AUTH` | `true` for OAuth, `false` for local dev |

#### Video Analysis (Optional)

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Gemini API key |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | GCP service account key |
| `GCS_BUCKET_NAME` | GCS bucket for video staging |
| `FIRESTORE_CACHE_TTL_HOURS` | Cache TTL (default: 24) |

## Deployment

### Docker

```bash
docker build -t google-ads-mcp .
docker run -d -p 3000:3000 --env-file .env google-ads-mcp
```

### Fly.io

```bash
fly deploy
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check (no auth) |
| `POST /mcp` | MCP request/response |
| `GET /mcp` | MCP SSE streaming |
| `DELETE /mcp` | Clean up MCP session |
| `GET /mcp-metadata` | MCP server metadata for `claude add` |

## Troubleshooting

**"Session not found"** — Restart Claude Code to create a fresh MCP session.

**"Unauthorized" errors** — Sessions last 24 hours. Re-authenticate by restarting Claude Code.

**Google Ads API errors** — Verify your developer token is approved and the customer ID format is `123-456-7890`.

## License

MIT

---

Built with the [Model Context Protocol SDK](https://github.com/modelcontextprotocol/sdk)
