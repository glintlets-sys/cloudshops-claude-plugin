# Install — Claude Desktop

Two paths depending on whether your tenant has a profile preset or not.

## 1. Install Claude Desktop

Download from <https://claude.com/download>. Sign in.

## 2. Get the server bundle

**Option A — clone this repo:**
```bash
git clone https://github.com/glintlets-sys/cloudshops-claude-plugin.git
```

The bundled `claude-plugin/server/dist/index.js` is committed and
self-contained — no `npm install` needed to run it.

**Option B — download just the bundled JS:**
```bash
mkdir -p ~/cloudshops-mcp-analytics
curl -sSL -o ~/cloudshops-mcp-analytics/index.js \
  https://raw.githubusercontent.com/glintlets-sys/cloudshops-claude-plugin/main/claude-plugin/server/dist/index.js
```

## 3. Mint your API token

In your tenant admin (e.g. `https://staging-admin.dinasidirect.com` for the
`dinasi-stage` profile) → **Settings → API Tokens → Generate**:

| Field | Value |
|---|---|
| Scope | `analytics:read` |
| Expiry | 10–90 days |
| Description | `Claude analytics — <your name>` |

Copy the token (shown once).

## 4A. Configure with a profile (preset tenants)

If your tenant has a known profile (e.g. `dinasi-stage`), you only need to
supply the token.

Edit `claude_desktop_config.json`:
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "cloudshops-analytics": {
      "command": "node",
      "args": ["<absolute-path-to>/dist/index.js"],
      "env": {
        "CLOUDSHOPS_PROFILE": "dinasi-stage",
        "CLOUDSHOPS_API_TOKEN": "<TOKEN>"
      }
    }
  }
}
```

## 4B. Configure without a profile (custom tenant)

If your tenant doesn't have a preset, supply all three values:

```json
{
  "mcpServers": {
    "cloudshops-analytics": {
      "command": "node",
      "args": ["<absolute-path-to>/dist/index.js"],
      "env": {
        "CLOUDSHOPS_API_URL": "https://api.example.com",
        "CLOUDSHOPS_API_TOKEN": "<TOKEN>",
        "CLOUDSHOPS_TENANT_ID": "your-tenant-id"
      }
    }
  }
}
```

> Path examples for `args[0]`:
> - Windows: `"C:/Users/<you>/cloudshops-claude-plugin/claude-plugin/server/dist/index.js"`
> - macOS: `"/Users/<you>/cloudshops-claude-plugin/claude-plugin/server/dist/index.js"`

## 5. Restart Claude Desktop

The `cloudshops-analytics` server should appear in the tools picker. Try:

> *"What are my top 10 customers by spend in the last month?"*

The LLM calls `describe_schema` first, then `run_sql`, summarises the result
in plain English. Done.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `cloudshops-mcp-analytics: missing required env var(s): ...` | You didn't set a profile and didn't set all three vars. Either pick a profile or supply URL+TENANT_ID+TOKEN. |
| `cloudshops-mcp-analytics: unknown CLOUDSHOPS_PROFILE='...'` | Typo in profile key. Check the supported list in this repo's README. |
| `401 invalid_token` | Token expired or revoked. Mint a fresh one. |
| `403 insufficient_scope` | Token has scope `orders:read` (default). Re-mint with `analytics:read`. |
| `404 invalid or missing tenant` | `CLOUDSHOPS_TENANT_ID` empty (and no profile). Check the env block. |
| `400 unsafe_sql` | The SQL safety validator blocked the query. SELECT-only, single statement. |
| Server doesn't show up | Check `claude_desktop_config.json` is valid JSON; restart Claude Desktop. |
| Empty results on every question | Analytics ETL hasn't run for your tenant. Tenant admin → Settings → Analytics → "Run Analytics Now". |
