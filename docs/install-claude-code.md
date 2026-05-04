# Install — Claude Code

Claude Code installs plugins through a **marketplace**. This repo is itself a
single-plugin marketplace (`.claude-plugin/marketplace.json` at the root), so
you can register it directly from GitHub or from a local clone.

## Option A — Install from GitHub (recommended for end users)

In a Claude Code session, run:

```
/plugin marketplace add glintlets-sys/cloudshops-claude-plugin
/plugin install cloudshops-analytics@cloudshops-claude-plugin
```

(`/plugin marketplace add` accepts `owner/repo`, a full `https://...` git URL,
or a local filesystem path.)

On first enable Claude Code reads `userConfig` from the plugin's
`plugin.json` and prompts you for the four values:

| Prompt | What to enter |
|---|---|
| **Preset profile** | `dinasi-stage` (if applicable) — leaves URL/Tenant blank below. Or leave empty for a custom tenant. |
| **Backend API URL** | If no profile: your Cloudshops backend URL (e.g. `https://api.example.com`). With a profile, leave empty. |
| **Analytics API Token** | The JWT from your tenant admin → Settings → API Tokens (scope=`analytics:read`). Stored in your OS keychain. |
| **Tenant ID** | If no profile: your tenant identifier. With a profile, leave empty. |

Verify the plugin is enabled:

```
/plugin list
```

You should see `cloudshops-analytics@cloudshops-claude-plugin` with status
`enabled`.

## Option B — Install from a local clone (for development)

```bash
git clone https://github.com/glintlets-sys/cloudshops-claude-plugin.git \
  ~/src/cloudshops-claude-plugin
```

Then in Claude Code:

```
/plugin marketplace add ~/src/cloudshops-claude-plugin
/plugin install cloudshops-analytics@cloudshops-claude-plugin
```

The committed `claude-plugin/server/dist/index.js` is self-contained — no
`npm install` needed unless you intend to rebuild after editing
`server/src/index.ts`.

## Option C — Manual MCP server registration (no plugin system)

If you'd rather skip the plugin layer and register the MCP server directly:

```bash
# With a profile (only the token is required):
claude mcp add cloudshops-analytics \
  --command node \
  --args "$HOME/src/cloudshops-claude-plugin/claude-plugin/server/dist/index.js" \
  --env CLOUDSHOPS_PROFILE=dinasi-stage \
  --env CLOUDSHOPS_API_TOKEN="<token>"

# Without a profile (full custom):
claude mcp add cloudshops-analytics \
  --command node \
  --args "$HOME/src/cloudshops-claude-plugin/claude-plugin/server/dist/index.js" \
  --env CLOUDSHOPS_API_URL=https://api.example.com \
  --env CLOUDSHOPS_API_TOKEN="<token>" \
  --env CLOUDSHOPS_TENANT_ID=your-tenant-id
```

This route bypasses `userConfig` prompts and the plugin lifecycle, so updates
have to be pulled and re-registered manually.

## 4. Try it

```
$ claude
> What are my top 10 customers by spend in the last month?
```

Claude calls `describe_schema` first, then `run_sql`, summarises in plain
English using friendly business names ("Customer firms", "Orders",
"Products" — not table names).

## Updating

For Option A/B (plugin install):

```
/plugin update cloudshops-analytics@cloudshops-claude-plugin
```

For Option C (manual MCP):

```bash
cd ~/src/cloudshops-claude-plugin && git pull
# then restart Claude Code so it re-reads dist/index.js
```

## Troubleshooting

Same as Claude Desktop — see [install-claude-desktop.md](install-claude-desktop.md#troubleshooting).
