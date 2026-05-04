# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.1] - 2026-05-04

### Fixed
- `dist/index.js` is now actually bundled with esbuild (`--bundle
  --platform=node --format=esm`), not just transpiled by `tsc`. The
  previous artifact `import`-ed `@modelcontextprotocol/sdk` at runtime,
  so any clean `claude plugin install` (no `node_modules` next to the
  cached dist) crashed with `ERR_MODULE_NOT_FOUND` and the MCP server
  showed `✗ Failed to connect`. The README's "no `npm install` needed"
  promise is now genuinely true.
- Plugin manifest's `author` field is an object (`{ "name": "..." }`)
  not a bare string, so `claude plugin install` validates instead of
  rejecting with `author: Invalid input: expected object, received
  string`. (Already shipped in repo HEAD before this version bump but
  worth surfacing.)

### Changed
- Build script switched from `tsc` to `esbuild`; `tsc --noEmit` is now
  exposed as `npm run typecheck` so type errors are still caught.
- Repo is now installable via Claude Code's marketplace flow:
  `.claude-plugin/marketplace.json` at repo root,
  `docs/install-claude-code.md` rewritten around `/plugin marketplace
  add` + `/plugin install`. (Earlier docs pointed at a `claude
  --plugin-dir` flag for persistent install, which doesn't exist for
  that purpose.)

## [0.4.0] - 2026-05-03

### Changed (BREAKING)
- Renamed env vars from `DINASI_*` to `CLOUDSHOPS_*`. The plugin is now
  vendor-neutral; Dinasi-specific config has moved to a profile preset.
- Removed hardcoded defaults for API URL and Tenant ID. Customers must
  either select a profile or supply all three values explicitly.
- Plugin name renamed from `dinasi-analytics` to `cloudshops-analytics`.
- Server name renamed from `dinasi-mcp-analytics` to `cloudshops-mcp-analytics`.
- Schema reference title generalised from "Dinasi analytics" to
  "Cloudshops analytics".

### Added
- `CLOUDSHOPS_PROFILE` env var (also exposed as `profile` in plugin
  userConfig). Set to a known key (e.g. `dinasi-stage`) and only the API
  token is required from the customer.
- Profile registry in `src/index.ts` (`PROFILES` constant) makes onboarding
  new tenants a one-line addition.
- Better error messages: missing-env errors now list which vars are missing
  AND hint at available profiles.

### Migration from 0.3.x
- Replace `DINASI_API_URL` → `CLOUDSHOPS_API_URL` (or set `CLOUDSHOPS_PROFILE=dinasi-stage`)
- Replace `DINASI_API_TOKEN` → `CLOUDSHOPS_API_TOKEN`
- Replace `DINASI_TENANT_ID` → `CLOUDSHOPS_TENANT_ID` (or set `CLOUDSHOPS_PROFILE=dinasi-stage`)

## [0.3.0] - 2026-04-30

### Added
- Friendly business-name glossary in `describe_schema` output. Users can ask
  about "Orders", "Customer firms", "Products", "Staff" — Claude translates
  to the right table internally.
- `save_analysis`, `list_saved_analyses`, `load_analysis` tools backed by
  per-tenant S3 prefix (`tenants/<tenant>/analyses/`).

### Changed
- Bundled artifact moved to `claude-plugin/server/dist/index.js`.
- Tool descriptions updated for clarity in conversational use.

## [0.2.0] - 2026-04-30

### Added
- Tenant isolation enforced via `x-tenant` header sourced from
  `DINASI_TENANT_ID`.
- 30s statement timeout and 10,000-row cap surfaced in tool descriptions.

## [0.1.0] - 2026-04-30

### Added
- Initial release: `describe_schema` and `run_sql` tools, forwarding to the
  backend `/api/admin/analytics/query` endpoint.
