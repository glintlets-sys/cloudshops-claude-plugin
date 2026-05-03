# Install — Claude Code

Claude Code (CLI / IDE) supports MCP plugins natively. Install the entire
`claude-plugin/` folder as a local plugin and Claude Code will prompt for
your config on first enable.

## 1. Clone or download the plugin folder

```bash
mkdir -p ~/.claude/plugins/local
git clone https://github.com/glintlets-sys/cloudshops-claude-plugin.git \
  ~/.claude/plugins/local/cloudshops-claude-plugin
```

The committed `dist/index.js` is self-contained — no `npm install` needed.

## 2. Enable the plugin

Point Claude Code at the plugin folder:

```bash
claude --plugin-dir ~/.claude/plugins/local/cloudshops-claude-plugin/claude-plugin
```

On first enable Claude Code will read `userConfig` from `plugin.json` and
prompt you for the four values:

| Prompt | What to enter |
|---|---|
| **Preset profile** | `dinasi-stage` (if applicable) — leaves URL/Tenant blank below. Or leave empty for a custom tenant. |
| **Backend API URL** | If no profile: your Cloudshops backend URL (e.g. `https://api.example.com`). With a profile, leave empty. |
| **Analytics API Token** | The JWT from your tenant admin → Settings → API Tokens (scope=`analytics:read`). Stored in your OS keychain. |
| **Tenant ID** | If no profile: your tenant identifier. With a profile, leave empty. |

## 3. Configure manually (alternative)

If you prefer manual MCP server registration:

```bash
# With a profile (only token needed):
claude mcp add cloudshops-analytics \
  --command node \
  --args "$HOME/.claude/plugins/local/cloudshops-claude-plugin/claude-plugin/server/dist/index.js" \
  --env CLOUDSHOPS_PROFILE=dinasi-stage \
  --env CLOUDSHOPS_API_TOKEN="<token>"

# Without a profile (full custom):
claude mcp add cloudshops-analytics \
  --command node \
  --args "$HOME/.claude/plugins/local/cloudshops-claude-plugin/claude-plugin/server/dist/index.js" \
  --env CLOUDSHOPS_API_URL=https://api.example.com \
  --env CLOUDSHOPS_API_TOKEN="<token>" \
  --env CLOUDSHOPS_TENANT_ID=your-tenant-id
```

## 4. Try it

```
$ claude
> What are my top 10 customers by spend in the last month?
```

Claude calls `describe_schema` first, then `run_sql`, summarises in plain
English using friendly business names ("Customer firms", "Orders",
"Products" — not table names).

## Updating

```bash
cd ~/.claude/plugins/local/cloudshops-claude-plugin
git pull
```

If a new version bumps the bundled `dist/index.js`, restart Claude Code
to pick it up.

## Troubleshooting

Same as Claude Desktop — see [install-claude-desktop.md](install-claude-desktop.md#troubleshooting).
