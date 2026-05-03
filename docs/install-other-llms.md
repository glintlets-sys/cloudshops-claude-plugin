# Install — Other LLM clients

The Cloudshops MCP server is a generic stdio-based MCP server — it works
with any client that speaks the Model Context Protocol. For LLMs that
don't speak MCP, you can still hit the underlying REST endpoint directly
via tool/function-calling.

## Get the bundle once

All clients below run the same `claude-plugin/server/dist/index.js`:

```bash
git clone https://github.com/glintlets-sys/cloudshops-claude-plugin.git
# Path you'll need: <clone>/claude-plugin/server/dist/index.js
```

Set your env vars (either pick a profile or supply all three):

| Var | Required | Notes |
|---|---|---|
| `CLOUDSHOPS_PROFILE` | optional | e.g. `dinasi-stage` — skips URL+TENANT below |
| `CLOUDSHOPS_API_URL` | if no profile | e.g. `https://api.example.com` |
| `CLOUDSHOPS_API_TOKEN` | always | JWT scope=`analytics:read` |
| `CLOUDSHOPS_TENANT_ID` | if no profile | e.g. `your-tenant-id` |

---

## MCP-compatible clients

### Cursor

Edit `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per-project):

```json
{
  "mcpServers": {
    "cloudshops-analytics": {
      "command": "node",
      "args": ["/absolute/path/to/claude-plugin/server/dist/index.js"],
      "env": {
        "CLOUDSHOPS_PROFILE": "dinasi-stage",
        "CLOUDSHOPS_API_TOKEN": "<TOKEN>"
      }
    }
  }
}
```

Reload Cursor; the tools appear under the MCP picker.

### Cline (VS Code extension)

Open the Cline panel → settings (gear icon) → **MCP Servers** → "Add new
MCP server". Use the same JSON shape as Cursor. Cline manages the file at
`~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
(macOS) or the equivalent on Windows/Linux.

### Continue.dev

Edit `~/.continue/config.json`:

```json
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "stdio",
          "command": "node",
          "args": ["/absolute/path/to/claude-plugin/server/dist/index.js"],
          "env": {
            "CLOUDSHOPS_PROFILE": "dinasi-stage",
            "CLOUDSHOPS_API_TOKEN": "<TOKEN>"
          }
        }
      }
    ]
  }
}
```

### Zed

In Zed `settings.json`:

```json
{
  "context_servers": {
    "cloudshops-analytics": {
      "command": {
        "path": "node",
        "args": ["/absolute/path/to/claude-plugin/server/dist/index.js"],
        "env": {
          "CLOUDSHOPS_PROFILE": "dinasi-stage",
          "CLOUDSHOPS_API_TOKEN": "<TOKEN>"
        }
      }
    }
  }
}
```

### Generic MCP client (custom integrations)

Any client that can spawn a stdio child process and speak MCP JSON-RPC
2.0 will work. Spawn:

```
node /absolute/path/to/claude-plugin/server/dist/index.js
```

with the four `CLOUDSHOPS_*` env vars set. The server writes a ready
banner to stderr (`cloudshops-mcp-analytics ready: <url> tenant=<id>`)
when initialisation succeeds.

---

## Non-MCP clients

The MCP server is just a thin forwarder over a REST endpoint. *Any* LLM
that supports tool/function-calling (OpenAI, Gemini, local Ollama,
LM Studio, Mistral, etc.) can hit the underlying endpoint directly
without needing MCP.

### The endpoint

```
POST {CLOUDSHOPS_API_URL}/api/admin/analytics/query
Authorization: Bearer {CLOUDSHOPS_API_TOKEN}
x-tenant: {CLOUDSHOPS_TENANT_ID}
Content-Type: application/json

{ "sql": "SELECT ... " }
```

Response:
```json
{
  "columns": ["..."],
  "rows": [["..."], ...],
  "rowCount": 123,
  "durationMs": 45,
  "truncated": false
}
```

### OpenAI tool-call (Python example)

```python
import os
import requests
from openai import OpenAI

API_URL = os.environ["CLOUDSHOPS_API_URL"]
API_TOKEN = os.environ["CLOUDSHOPS_API_TOKEN"]
TENANT_ID = os.environ["CLOUDSHOPS_TENANT_ID"]

def run_sql(sql: str) -> dict:
    r = requests.post(
        f"{API_URL}/api/admin/analytics/query",
        headers={
            "Authorization": f"Bearer {API_TOKEN}",
            "x-tenant": TENANT_ID,
            "Content-Type": "application/json",
        },
        json={"sql": sql},
        timeout=35,
    )
    r.raise_for_status()
    return r.json()

tools = [{
    "type": "function",
    "function": {
        "name": "run_sql",
        "description": (
            "Execute one SELECT/WITH query against the Cloudshops "
            "analytics DB. SELECT-only, 30s timeout, 10k row cap."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "sql": {"type": "string"},
            },
            "required": ["sql"],
        },
    },
}]

# Now use tools=tools when calling client.chat.completions.create(...)
# and route any tool_calls to run_sql().
```

For schema awareness, fetch `describe_schema` once at conversation start
and inject it as a system prompt — the MCP server's
`describe_schema` tool just returns a static markdown reference, and the
content lives at the top of `claude-plugin/server/src/index.ts` (the
`SCHEMA_REFERENCE` constant) if you want it as a string.

### Gemini function-calling

Same shape — define a `FunctionDeclaration` for `run_sql` with one string
parameter `sql`, and call the REST endpoint when the model invokes it.

### Local LLMs (Ollama / LM Studio / vLLM)

If your local model supports function-calling (Llama 3.1+, Mistral,
Qwen2.5+), define the tool the same way and route invocations through
the REST endpoint.

If your local model doesn't support function-calling, you can still
prompt it with the schema reference and ask it to emit SQL, then
manually run the query and feed the results back. Less elegant but
works on any model.

---

## Saved-analyses tools (S3 round-trip)

Three additional endpoints back the `save_analysis`, `list_saved_analyses`,
and `load_analysis` tools:

```
POST {API_URL}/api/admin/analytics/s3/signed-url
  Body: { "operation": "PUT" | "GET", "key": "<filename>", "contentType?": "..." }
  Returns: { "url": "<presigned>", "keyFull": "tenants/<tenant>/analyses/<filename>", ... }

GET  {API_URL}/api/admin/analytics/s3/list?prefix=<optional>
  Returns: { "objects": [{ "key": "...", "size": N, "lastModified": "..." }, ...], "count": N }
```

For PUT, presign returns a short-lived URL — upload the body there.
For GET, presign returns a download URL — fetch verbatim. See
`claude-plugin/server/src/index.ts` (`saveAnalysis`, `listSavedAnalyses`,
`loadAnalysis`) for the exact dance.
