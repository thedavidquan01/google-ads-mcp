# Team Onboarding Guide - Google Ads MCP

## Quick Start (30 Seconds)

### Option 1: One Command (Recommended)

**Step 1:** Copy this command and paste it into your terminal:

```bash
claude mcp add google-ads --transport http https://sp-google-ads-mcp.fly.dev/mcp
```

**Step 2:** When Claude Code starts, just ask:
```
"Show me campaign performance for last 7 days"
```

Claude will automatically prompt you to authenticate with Google, and you're done!

---

### Option 2: Manual Configuration

If `claude mcp add` doesn't work, manually edit `~/.config/claude-code/mcp.json`:

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

Then restart Claude Code.

---

## Troubleshooting

### "Session not found" or "Connection reset" after updates

**This is completely normal after server updates!** When the server redeploys, all connections are reset.

**Solution (takes 10 seconds):**
1. **Close Claude Code completely** (Cmd+Q on Mac, or close the window)
2. **Reopen Claude Code**
3. Try your query again
4. If prompted to authenticate, click the link and sign in with Google

**Why this happens:**
- The server was updated with new features or bug fixes
- All active connections are reset during deployment
- Your authentication is safe - just needs to reconnect

### "Connection failed" or "Connection error"

**Solution:**
1. Check your internet connection
2. Restart Claude Code
3. If still failing, check server status (ask your admin)

### Session expired (after 24 hours)

Your session lasts 24 hours. When it expires:
1. Claude will prompt you to re-authenticate
2. Click the authentication link
3. Sign in with Google again

### Still having issues?

Contact the team admin or check the server status:
```bash
curl https://sp-google-ads-mcp.fly.dev/health
```

---

## What You Can Do

### Campaign & Ad Performance
- "Show me campaign performance for last 7 days"
- "What's my best performing ad group?"
- "Compare this week vs last week performance"
- "List all active campaigns"

### Keyword Analysis
- "Show keyword performance for campaign X"
- "Which keywords have the highest quality score?"
- "Find keywords with high spend but low conversions"

### YouTube Video Analysis
- "Show YouTube video ad performance"
- "Analyze the video creative for ad 123456789"
- "What demographics are watching our video ads?"
- "Get details on our YouTube ads"

### Comparisons
- "Compare campaign A vs campaign B"
- "Compare last 30 days vs previous 30 days"
- "Which ad groups are outperforming?"

---

## Security Notes

- Each team member authenticates with **their own Google account**
- Sessions are isolated per user
- All data is encrypted in transit (HTTPS)
- Sessions expire after 24 hours for security
