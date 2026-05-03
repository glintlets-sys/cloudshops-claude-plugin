# claude-plugin

Drop-in Claude Code plugin folder. Layout follows the
[Claude Code plugin spec](https://docs.claude.com/en/docs/claude-code/plugins).

```
claude-plugin/
├── .claude-plugin/
│   └── plugin.json     Plugin manifest + userConfig schema (profile + 3 vars)
├── .mcp.json           MCP server registration
└── server/
    ├── dist/index.js   Bundled stdio MCP server (committed)
    ├── src/index.ts    Source -- add new tenant profiles here
    ├── package.json
    ├── tsconfig.json
    └── .env.example
```

## userConfig fields

| Field | Required | Notes |
|---|---|---|
| `profile` | optional | Pick a known tenant preset (e.g. `dinasi-stage`). Skips having to enter API URL + Tenant ID. |
| `api_url` | required if no profile | Cloudshops backend gateway base URL. Overrides profile when set. |
| `api_token` | always required | JWT with scope `analytics:read`. Stored in OS keychain. |
| `tenant_id` | required if no profile | Tenant identifier sent in `x-tenant` header. Overrides profile when set. |

## Install (Claude Code)

See [../docs/install-claude-code.md](../docs/install-claude-code.md) for the
end-user install flow.

## Re-build the bundle

```bash
cd server
npm install
npm run build
```

Produces `server/dist/index.js`.

## Run standalone (no LLM client attached)

```bash
cd server
cp .env.example .env
# either set CLOUDSHOPS_PROFILE=dinasi-stage and CLOUDSHOPS_API_TOKEN
# or set all three CLOUDSHOPS_API_URL/TOKEN/TENANT_ID
npm install
npm run dev
```

Stdio is interactive; the server logs `cloudshops-mcp-analytics ready: <url> tenant=<id>` to stderr.

## License

Apache-2.0. See [../LICENSE](../LICENSE).
