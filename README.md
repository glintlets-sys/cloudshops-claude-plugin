# cloudshops-claude-plugin

MCP plugin and connector for the **Cloudshops** analytics gateway. Lets any
MCP-compatible LLM client (Claude Desktop, Claude Code, Cursor, Cline,
Continue, Zed, etc.) ask questions of your business data in plain language and
get back real numbers — top customers, sales-rep performance, slipping
accounts, product-mix trends — without writing SQL.

The server is a **thin forwarder**. It holds no DB credentials. Every call
goes to *your* Cloudshops backend gateway with a Bearer JWT and an `x-tenant`
header; the backend enforces auth, scope, SQL safety, statement timeout,
and row caps.

## Profiles vs custom config

You configure the plugin in **one of two modes**:

**1. Profile preset (easiest).** Pick a known tenant from the profile
dropdown and you only have to enter the API token. Currently supported:

| Profile | API URL | Tenant |
|---|---|---|
| `dinasi-stage` | `https://api.dinasidirect.com` | `mcs-stage` |

More profiles can be added as new tenants onboard — see
[claude-plugin/server/src/index.ts](claude-plugin/server/src/index.ts) `PROFILES` constant.

**2. Custom (any Cloudshops tenant).** Leave the profile blank and supply
all three values:

| Variable | What it is |
|---|---|
| `CLOUDSHOPS_API_URL` | Your Cloudshops backend gateway base URL, e.g. `https://api.example.com` (no trailing slash) |
| `CLOUDSHOPS_API_TOKEN` | JWT minted in your tenant admin → Settings → API Tokens with scope `analytics:read` |
| `CLOUDSHOPS_TENANT_ID` | Tenant identifier sent in the `x-tenant` header (must match the tenant claim in the JWT) |

When you set both a profile and explicit env vars, the explicit vars win.

## Tools exposed

| Tool | Purpose |
|---|---|
| `describe_schema` | Markdown reference of tables, columns, PII flags, and worked examples. Call first in a new conversation. |
| `run_sql` | Execute one SELECT/WITH query. Returns a compact text table. SELECT-only, 30s timeout, 10k row cap. |
| `save_analysis` | Persist a report (text/md/json/csv) to your tenant's S3 prefix. |
| `list_saved_analyses` | List previously saved reports for your tenant. |
| `load_analysis` | Load a saved report by filename. |

## Install

| Client | Guide |
|---|---|
| Claude Desktop | [docs/install-claude-desktop.md](docs/install-claude-desktop.md) |
| Claude Code (CLI / IDE) | [docs/install-claude-code.md](docs/install-claude-code.md) |
| Other MCP clients (Cursor, Cline, Continue, Zed) | [docs/install-other-llms.md](docs/install-other-llms.md) |
| Non-MCP LLMs (OpenAI, Gemini, Ollama tool-calls) | [docs/install-other-llms.md#non-mcp-clients](docs/install-other-llms.md#non-mcp-clients) |

## Quick verify (no LLM needed)

```bash
TOKEN="<your analytics:read JWT>"
API_URL="<your Cloudshops backend>"     # e.g. https://api.dinasidirect.com
TENANT="<your tenant id>"                # e.g. mcs-stage

curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-tenant: $TENANT" \
  -H "Content-Type: application/json" \
  -d '{"sql":"SELECT 1 AS one"}' \
  "$API_URL/api/admin/analytics/query"
```

Expected: `{"columns":["one"],"rows":[[1]],"rowCount":1,"truncated":false,...}`

## Repo layout

```
.
├── claude-plugin/              Drop-in Claude Code plugin
│   ├── .claude-plugin/
│   │   └── plugin.json         Plugin manifest + userConfig schema (profile + 3 vars)
│   ├── .mcp.json               MCP server registration
│   ├── README.md
│   └── server/
│       ├── dist/index.js       Bundled, self-contained server (run with `node`)
│       ├── src/index.ts        Source (TypeScript) -- add new profiles here
│       ├── package.json
│       ├── tsconfig.json
│       └── .env.example
├── docs/
│   ├── install-claude-desktop.md
│   ├── install-claude-code.md
│   └── install-other-llms.md
├── examples/
│   └── prompts.md              Sample questions to ask
├── CHANGELOG.md
├── LICENSE                     Apache-2.0
└── README.md                   (this file)
```

## Building from source

The `claude-plugin/server/dist/index.js` artifact is committed — you can run
it directly with `node` and skip the build step. To rebuild (e.g. after
adding a profile):

```bash
cd claude-plugin/server
npm install
npm run build           # produces dist/index.js
```

## Adding a new tenant profile

Edit `claude-plugin/server/src/index.ts`, extend the `PROFILES` constant:

```ts
const PROFILES: Record<string, Profile> = {
  "dinasi-stage": {
    apiUrl: "https://api.dinasidirect.com",
    tenantId: "mcs-stage",
    label: "Dinasi Direct (staging)",
  },
  "your-tenant-key": {
    apiUrl: "https://api.example.com",
    tenantId: "your-tenant-id",
    label: "Your Tenant (env)",
  },
};
```

Then `npm run build`, commit, and bump the version in `package.json` and
`plugin.json`.

## Security

- The MCP server forwards requests; it does not store credentials, query the
  DB directly, or accept arbitrary SQL. Backend `SqlSafetyValidator` rejects
  anything beyond a single SELECT/WITH.
- Tokens are scoped (`analytics:read`) and tenant-bound. Mint per-user
  tokens with short expiries (10–90 days) and revoke when an employee
  leaves or a laptop is lost.
- `.env` files and tokens are never committed. See `.gitignore`.

## License

Apache-2.0. See [LICENSE](LICENSE).
