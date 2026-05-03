#!/usr/bin/env node
/**
 * Cloudshops analytics MCP server.
 *
 * Exposes five tools to LLM clients (Claude Desktop, Claude Code, Cursor,
 * Cline, Continue, Zed -- anything that speaks MCP):
 *   - describe_schema()                  reference for the analytics schema (call first)
 *   - run_sql(sql)                       run a SELECT/WITH against the analytics DB
 *   - save_analysis(filename, content)   write a report/insight to tenant S3 store
 *   - list_saved_analyses(prefix?)       see what's been saved
 *   - load_analysis(filename)            fetch a previously saved analysis as text
 *
 * The server is a thin shim. It holds no AWS or DB credentials -- everything
 * routes through `${CLOUDSHOPS_API_URL}/api/admin/...` with a Bearer ApiToken
 * (scope=analytics:read) and the x-tenant header. Tenant isolation lives in
 * the backend; the JWT's tenant claim is the source of truth there. The
 * S3 save/load flow uses short-lived presigned URLs issued by the backend.
 *
 * Configuration (env vars, see .env.example):
 *   CLOUDSHOPS_PROFILE   -- optional. One of the keys in PROFILES below
 *                           (e.g. "dinasi-stage"). When set, API_URL and
 *                           TENANT_ID are auto-filled from the preset and
 *                           the customer only needs to supply the token.
 *                           Leave empty for fully custom config.
 *   CLOUDSHOPS_API_URL   -- backend gateway base URL, no trailing slash
 *                           (required if no profile)
 *   CLOUDSHOPS_API_TOKEN -- JWT with scope=analytics:read (always required)
 *   CLOUDSHOPS_TENANT_ID -- tenant identifier sent in x-tenant header
 *                           (required if no profile)
 *
 * Customer values explicitly set via env always override profile presets.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import "dotenv/config";

// ---------------------------------------------------------------------------
// Profile presets. Add new tenants here as they onboard.
// ---------------------------------------------------------------------------

interface Profile {
  apiUrl: string;
  tenantId: string;
  label: string;
}

const PROFILES: Record<string, Profile> = {
  "dinasi-stage": {
    apiUrl: "https://api.dinasidirect.com",
    tenantId: "mcs-stage",
    label: "Dinasi Direct (staging)",
  },
};

const profileKey = (process.env.CLOUDSHOPS_PROFILE ?? "").trim();
const profile = profileKey ? PROFILES[profileKey] : undefined;

if (profileKey && !profile) {
  console.error(
    `cloudshops-mcp-analytics: unknown CLOUDSHOPS_PROFILE='${profileKey}'. ` +
    `Known profiles: ${Object.keys(PROFILES).join(", ") || "(none)"}.`,
  );
  process.exit(1);
}

const rawApiUrl = (process.env.CLOUDSHOPS_API_URL ?? "").trim() || profile?.apiUrl || "";
const API_URL = rawApiUrl.replace(/\/$/, "");
const API_TOKEN = (process.env.CLOUDSHOPS_API_TOKEN ?? "").trim();
const TENANT_ID = (process.env.CLOUDSHOPS_TENANT_ID ?? "").trim() || profile?.tenantId || "";

const missing: string[] = [];
if (!API_URL) missing.push("CLOUDSHOPS_API_URL");
if (!API_TOKEN) missing.push("CLOUDSHOPS_API_TOKEN");
if (!TENANT_ID) missing.push("CLOUDSHOPS_TENANT_ID");

if (missing.length > 0) {
  const profileHint = profileKey
    ? ` (profile '${profileKey}' supplied: ${profile?.apiUrl}, tenant=${profile?.tenantId})`
    : ` (or set CLOUDSHOPS_PROFILE to one of: ${Object.keys(PROFILES).join(", ") || "(none)"})`;
  console.error(
    `cloudshops-mcp-analytics: missing required env var(s): ${missing.join(", ")}.${profileHint}`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Schema reference (returned by describe_schema). Compact -- the goal is to
// give Claude enough to write correct SQL without ever needing to fetch
// INFORMATION_SCHEMA. PII columns are explicitly annotated.
// ---------------------------------------------------------------------------

const SCHEMA_REFERENCE = `# Cloudshops analytics — schema reference

You are scoped to tenant **${TENANT_ID}**. Read-only SELECT / WITH only;
statement timeout 30s; row cap 10,000.

## Business glossary

When the user asks about... use this table in your SQL. When you summarise
results back to the user, use the friendly name on the left.

| What the user calls it | Table name (used in SQL) |
|---|---|
| **Orders** | \`fact_purchase\` |
| **Order line items** ("what was bought") | \`fact_purchase_item\` |
| **Customer firms** ("shops" / B2B accounts) | \`dim_customer_account\` |
| **Customers** ("the person buying", "shop owner") | \`dim_customer\` |
| **Products** / catalog | \`dim_toy\` |
| **Staff** ("sales reps", "agents", "team") | \`dim_staff\` |
| **Staff–firm assignments** ("territory", "ownership") | \`fact_staff_customer_account_assignment\` |
| **Delivery trips** ("routes", "runs") | \`fact_delivery_trip\` |
| **Payments collected** at delivery | \`fact_payment_collection\` |
| **Returns** ("returned items", "refused stock") | \`fact_delivery_return\` |
| **Calendar** / dates | \`dim_date\` |

Always write SQL with the right-hand column. Always speak to the user using
the left-hand column. If you have to mention a column name to the user (e.g.
"created_date"), translate it too — say "order date", "join date", etc.

## Universal columns
Every row has \`source_id\` (the source-side PK; this is what FK columns
reference, NOT the surrogate \`id\`), \`tenant_id\`, and \`loaded_at\`.

## Orders — \`fact_purchase\`
One row per order placed.
Key cols: \`source_id\`, \`customer_id\`, \`customer_account_id\` (the firm),
\`staff_user_id\` (NULL = customer self-service), \`payment_status\`,
\`payment_gateway\`, \`amount\` (legacy total), \`subtotal_amount\`,
\`tax_amount\`, \`discount_amount\`, \`coupon_code\`,
\`delivery_charge_amount\`, \`total_amount\` (preferred for revenue rollups
when present), \`coupon_usage_id\`, \`parent_order_id\`, \`is_split_child\`,
\`delivery_pincode\`, \`delivery_city\`, \`delivery_state\`, \`delivery_lat\`,
\`delivery_lng\`, \`creation_date\` (the order date), \`expiry_time\`,
\`whatsapp_sent\`, \`whatsapp_sent_at\`.

## Order line items — \`fact_purchase_item\`
What was bought in each order. Parsed from order JSON.
Key cols: \`order_id\` (→ \`fact_purchase.source_id\`), \`line_number\`,
\`toy_id\` (the product), \`variation_id\` (~15% NULL on legacy),
\`product_name\`, \`product_code\`, \`quantity\`, \`unit_price\`,
\`total_price\`, \`tax_amount\`, \`discount_amount\`, \`image_link\`,
\`order_creation_date\`, \`customer_account_id\`, \`customer_id\`,
\`staff_user_id\`. Unique on (order_id, line_number).

## Customer firms — \`dim_customer_account\`
The B2B shop / business buyer.
Key cols: \`source_id\`, \`company_name\` [PII], \`customer_name\` [PII],
\`gst_number\` [PII], \`whatsapp_number\` [PII], \`contact_number\` [PII],
\`pincode\`, \`state\`, \`city\`, \`status\`, \`referrer_fse_phone\` [PII],
\`address_line\` [PII], \`lat\` [PII], \`lng\` [PII], \`created_date\`,
\`updated_date\`, \`redacted_at\`, \`redaction_reason\`.

## Customers — \`dim_customer\`
The actual person at the shop who places orders.
Key cols: \`source_id\`, \`name\` [PII], \`email\` [PII],
\`mobile_number\` [PII], \`address\` [PII], \`pincode\`, \`age\`, \`sex\`,
\`status\`, \`can_place_orders\`, \`customer_account_id\` (their firm),
\`customer_account_associated_date\`, \`creation_date\`, \`redacted_at\`,
\`redaction_reason\`.

## Staff — \`dim_staff\`
Sales reps / field agents / team members.
Key cols: \`source_id\`, \`staff_code\`, \`current_user_id\`,
\`current_user_name\` [PII], \`current_user_email\` [PII],
\`current_user_mobile\` [PII], \`role_id\`, \`role_name\` (e.g. "Sales
Executive", "Area Head"), \`region_id\`, \`manager_id\`, \`status\`,
\`is_active\`, \`created_date\`, \`updated_date\`, \`redacted_at\`,
\`redaction_reason\`.

## Products — \`dim_toy\`
Catalog of items the firms order. No PII.
Key cols: \`source_id\`, \`name\` (the product name), \`code\`, \`hsn\`,
\`brand\`, \`tax_pct\`, \`active\`, \`stock_type\` (Managed / Unmanaged),
\`featured\`, \`not_available\`, \`units\`, \`packing_type\`,
\`pieces_per_sku\`, \`min_order_quantity\`, \`max_order_quantity\`,
\`weight\`, \`current_price_amount\`, \`current_price_currency\`,
\`current_discount_pct\`, \`primary_category_id\`, \`primary_category_name\`
(may be NULL in v1).

## Staff–firm assignments — \`fact_staff_customer_account_assignment\`
Which staff is responsible for which customer firm. Use \`is_active = 1\`
for current ownership. For historical revenue attribution, join on the
date window: \`assigned_date <= order_date < COALESCE(unassigned_date, NOW())\`.
Key cols: \`source_id\`, \`staff_id\` (→ \`dim_staff.source_id\`),
\`customer_account_id\` (→ \`dim_customer_account.source_id\`),
\`is_active\`, \`assigned_date\`, \`unassigned_date\` (NULL = current),
\`duration_days\`, \`notes\`, \`created_date\`, \`updated_date\`.

## Delivery trips — \`fact_delivery_trip\`
One row per delivery run.
Key cols: \`source_id\`, \`trip_date\`, \`delivery_agent_user_id\`,
\`vehicle_number\`, \`depot_name\`, \`status\`, \`created_at\`,
\`started_at\`, \`returned_at\`, \`closed_at\`, \`orders_attached\`,
\`orders_delivered\`, \`orders_returned\`, \`orders_failed\`,
\`total_collection_amount\`, \`total_return_amount\`,
\`driver_payout_amount\`, \`driver_payout_status\`.

## Payments collected — \`fact_payment_collection\`
Cash / UPI / card / cheque collected at delivery, with breakdowns.
Key cols: \`source_id\`, \`order_id\`, \`delivery_agent_user_id\`,
\`dispatch_summary_id\`, \`total_amount\`, \`cash_amount\`, \`upi_amount\`,
\`card_amount\`, \`cheque_amount\`, \`other_amount\`, \`payment_count\`,
\`collected_at\`, \`fsc\`.

## Returns — \`fact_delivery_return\`
Items the customer refused or returned at the door.
Key cols: \`source_id\`, \`order_id\`, \`delivery_agent_user_id\`,
\`total_amount_to_deduct\`, \`item_count\`, \`total_quantity_returned\`,
\`source_channel\` (ADMIN_PANEL / EXTERNAL_API / FIELD_APP), \`returned_at\`.

## Calendar — \`dim_date\`
Synthetic calendar 2020–2030. Useful for fiscal-quarter rollups,
weekend filters, etc.
Key cols: \`date_key\` (PK, DATE), \`year\`, \`quarter\`, \`month\`,
\`month_name\`, \`day\`, \`day_of_week\`, \`day_name\`, \`week_of_year\`,
\`is_weekend\`, \`fiscal_year\` (Apr–Mar, Indian fiscal),
\`fiscal_quarter\`.

## PII guidance
Columns marked [PII] hold personal data. When the user asks for an
analysis (especially one they intend to publish or share), prefer
aggregated views that don't require PII. If a row's \`redacted_at IS NOT
NULL\`, the PII columns will be NULL on that row — that's the user's
deletion request being honoured.

## Worked examples (these all return real numbers, but always summarise to
   the user using the friendly names from the glossary above)

-- "Top customer firms by spend, last 30 days"
SELECT ca.company_name, ca.city, COUNT(*) AS orders,
       SUM(COALESCE(p.total_amount, p.amount, 0)) AS total_spend
FROM fact_purchase p
JOIN dim_customer_account ca ON ca.source_id = p.customer_account_id
WHERE p.creation_date >= NOW() - INTERVAL 30 DAY
GROUP BY ca.source_id, ca.company_name, ca.city
ORDER BY total_spend DESC LIMIT 10;
-- → "Here are the top 10 customer firms by spend in the last month..."

-- "Staff performance: revenue from their assigned firms (last 30 days)"
SELECT s.staff_code, s.role_name,
       SUM(COALESCE(p.total_amount, p.amount, 0)) AS revenue
FROM fact_staff_customer_account_assignment a
JOIN dim_staff s ON s.source_id = a.staff_id
JOIN fact_purchase p
  ON p.customer_account_id = a.customer_account_id
 AND p.creation_date >= a.assigned_date
 AND p.creation_date <  COALESCE(a.unassigned_date, NOW())
WHERE p.creation_date >= NOW() - INTERVAL 30 DAY
GROUP BY s.source_id, s.staff_code, s.role_name
ORDER BY revenue DESC;
-- → "Here's how each sales rep is doing this month..."

-- "How balanced is the staff workload — how many firms each one looks after"
SELECT s.staff_code, s.role_name, COUNT(*) AS active_firms
FROM fact_staff_customer_account_assignment a
JOIN dim_staff s ON s.source_id = a.staff_id
WHERE a.is_active = 1
GROUP BY s.source_id, s.staff_code, s.role_name
ORDER BY active_firms DESC;
-- → "Here's the current workload distribution across your team..."

-- "Customer firms with no assigned staff"
SELECT ca.source_id, ca.company_name, ca.city
FROM dim_customer_account ca
LEFT JOIN fact_staff_customer_account_assignment a
  ON a.customer_account_id = ca.source_id AND a.is_active = 1
WHERE a.id IS NULL AND (ca.redacted_at IS NULL);
-- → "These customer firms don't have a sales rep assigned..."

-- "Top-selling products (last 30 days, by units)"
SELECT t.name AS product_name, t.brand,
       SUM(i.quantity) AS units_sold,
       SUM(i.total_price) AS revenue
FROM fact_purchase_item i
JOIN dim_toy t ON t.source_id = i.toy_id
WHERE i.order_creation_date >= NOW() - INTERVAL 30 DAY
GROUP BY t.source_id, t.name, t.brand
ORDER BY units_sold DESC LIMIT 20;
-- → "These are your best-selling products in the last month..."

-- "Pincode delivery hotspots (last 7 days)"
SELECT p.delivery_pincode AS pincode, COUNT(*) AS orders,
       SUM(COALESCE(p.total_amount, p.amount, 0)) AS revenue
FROM fact_purchase p
WHERE p.creation_date >= NOW() - INTERVAL 7 DAY
  AND p.delivery_pincode IS NOT NULL
GROUP BY p.delivery_pincode
ORDER BY orders DESC LIMIT 20;
-- → "Most deliveries this week went to these pincodes..."

-- "Today's cash collection vs returns by delivery agent"
SELECT pc.delivery_agent_user_id AS agent,
       SUM(pc.cash_amount) AS cash_today,
       SUM(pc.upi_amount)  AS upi_today,
       (SELECT IFNULL(SUM(r.total_amount_to_deduct),0)
          FROM fact_delivery_return r
         WHERE r.delivery_agent_user_id = pc.delivery_agent_user_id
           AND DATE(r.returned_at) = CURDATE()) AS returns_today
FROM fact_payment_collection pc
WHERE DATE(pc.collected_at) = CURDATE()
GROUP BY pc.delivery_agent_user_id
ORDER BY cash_today DESC;
-- → "Here's the agent-by-agent collection summary for today..."
`;

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const tools: Tool[] = [
  {
    name: "describe_schema",
    description:
      "Return a markdown reference describing the analytics tables, columns, PII annotations, " +
      "conventions, and example queries. Call this first when starting a new analytics conversation -- " +
      "it gives you everything you need to write correct SQL without trial-and-error against INFORMATION_SCHEMA.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "run_sql",
    description:
      "Execute a single SELECT (or WITH ... SELECT) query against the analytics database. " +
      "Returns rows as a compact text table with column names, row count, and duration. " +
      "Statement timeout is 30s, row cap is 10,000 (response includes a `truncated` flag). " +
      "DDL/DML keywords are rejected by the backend safety validator.",
    inputSchema: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description:
            "The SELECT or WITH query to run. Must be a single statement (no semicolons except possibly trailing). No DDL/DML.",
        },
      },
      required: ["sql"],
    },
  },
  {
    name: "save_analysis",
    description:
      "Save an analysis (text/markdown/JSON/CSV) to the tenant's S3 store under " +
      "tenants/<tenant>/analyses/<filename>. Use this to persist insights, reports, or query " +
      "results the user wants to revisit. Subfolders are supported (e.g. '2026-04/q1-report.md'). " +
      "Returns the resulting key. Tenant isolation is enforced server-side; you cannot save " +
      "outside this token's tenant prefix.",
    inputSchema: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description: "Filename or relative path under the tenant's analyses prefix. " +
            "Supports subfolders, e.g. '2026-04/q1-report.json'. No '..' or leading '/'.",
        },
        content: {
          type: "string",
          description: "The text content to save. For JSON pass a JSON.stringify-ed string; " +
            "for CSV the CSV text; for markdown the markdown source. Up to ~10MB.",
        },
        contentType: {
          type: "string",
          description: "MIME content type. If omitted, inferred from the filename extension " +
            "(.json, .csv, .md, .txt, .html, .pdf). Falls back to application/octet-stream.",
        },
      },
      required: ["filename", "content"],
    },
  },
  {
    name: "list_saved_analyses",
    description:
      "List analyses saved by this tenant. Returns filenames, sizes, and last-modified " +
      "timestamps. Useful to discover what's been saved before deciding to load or save.",
    inputSchema: {
      type: "object",
      properties: {
        prefix: {
          type: "string",
          description: "Optional sub-path filter, e.g. '2026-04/' to list only that folder.",
        },
      },
    },
  },
  {
    name: "load_analysis",
    description:
      "Load a previously saved analysis by filename. Returns the file contents as text " +
      "(verbatim -- if it was JSON when saved, you'll need to JSON.parse). Use this to retrieve " +
      "a stored report or continue analysis from where you left off.",
    inputSchema: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description: "The filename to load. Same path used when saving.",
        },
      },
      required: ["filename"],
    },
  },
];

// ---------------------------------------------------------------------------
// Server wiring
// ---------------------------------------------------------------------------

const server = new Server(
  {
    name: "cloudshops-mcp-analytics",
    version: "0.4.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "describe_schema") {
    return { content: [{ type: "text", text: SCHEMA_REFERENCE }] };
  }

  if (name === "run_sql") {
    const sql = (args?.sql as string | undefined)?.trim();
    if (!sql) {
      return errorResult("Error: empty SQL.");
    }
    return await runSql(sql);
  }

  if (name === "save_analysis") {
    const filename = (args?.filename as string | undefined)?.trim();
    const content = args?.content as string | undefined;
    const contentType = (args?.contentType as string | undefined)?.trim();
    if (!filename) return errorResult("Error: filename is required.");
    if (content === undefined || content === null) {
      return errorResult("Error: content is required.");
    }
    return await saveAnalysis(filename, String(content), contentType);
  }

  if (name === "list_saved_analyses") {
    const prefix = (args?.prefix as string | undefined)?.trim();
    return await listSavedAnalyses(prefix);
  }

  if (name === "load_analysis") {
    const filename = (args?.filename as string | undefined)?.trim();
    if (!filename) return errorResult("Error: filename is required.");
    return await loadAnalysis(filename);
  }

  return errorResult(`Unknown tool: ${name}`);
});

interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  durationMs: number;
  truncated: boolean;
}

async function runSql(sql: string) {
  const url = `${API_URL}/api/admin/analytics/query`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_TOKEN}`,
        "x-tenant": TENANT_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql }),
    });
  } catch (err: any) {
    return {
      content: [{ type: "text" as const, text: `Network error reaching ${url}: ${err?.message ?? err}` }],
      isError: true,
    };
  }

  const text = await response.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    const reason = body?.message || body?.error || JSON.stringify(body);
    return {
      content: [{ type: "text" as const, text: `Backend ${response.status} ${response.statusText}: ${reason}` }],
      isError: true,
    };
  }

  return {
    content: [{ type: "text" as const, text: formatResult(body as QueryResult) }],
  };
}

function formatResult(r: QueryResult): string {
  const meta =
    `${r.rowCount} row(s)  |  ${r.durationMs} ms` +
    (r.truncated ? "  |  TRUNCATED at row cap (10,000)" : "");

  if (r.rowCount === 0) {
    return `${meta}\n(no rows)`;
  }

  // Compact ASCII table. Column widths sized to the longest cell or header.
  const widths = r.columns.map((c, i) =>
    Math.max(
      c.length,
      ...r.rows.map((row) => stringify(row[i]).length),
    ),
  );
  const fmtRow = (cells: unknown[]) =>
    cells.map((cell, i) => stringify(cell).padEnd(widths[i])).join(" | ");

  const header = fmtRow(r.columns);
  const sep = widths.map((w) => "-".repeat(w)).join("-+-");
  const lines = r.rows.map(fmtRow);
  return `${meta}\n\n${header}\n${sep}\n${lines.join("\n")}`;
}

function stringify(cell: unknown): string {
  if (cell === null || cell === undefined) return "NULL";
  if (typeof cell === "string") return cell;
  if (typeof cell === "object") return JSON.stringify(cell);
  return String(cell);
}

// ---------------------------------------------------------------------------
// S3 save / list / load
// ---------------------------------------------------------------------------

interface PresignedUrlResponse {
  url: string;
  expiresAt: string;
  keyFull: string;
  operation: string;
}

interface ListResponse {
  objects: Array<{ keyFull: string; key: string; size: number; lastModified: string | null }>;
  count: number;
}

const S3_HEADERS = (): Record<string, string> => ({
  "Authorization": `Bearer ${API_TOKEN}`,
  "x-tenant": TENANT_ID,
  "Content-Type": "application/json",
});

async function presign(operation: "PUT" | "GET", filename: string, contentType?: string) {
  const body: Record<string, string> = { operation, key: filename };
  if (operation === "PUT" && contentType) body.contentType = contentType;
  const res = await fetch(`${API_URL}/api/admin/analytics/s3/signed-url`, {
    method: "POST",
    headers: S3_HEADERS(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Backend ${res.status} ${res.statusText} on signed-url ${operation}: ${text}`);
  }
  return JSON.parse(text) as PresignedUrlResponse;
}

async function saveAnalysis(filename: string, content: string, contentType?: string) {
  const ct = contentType || inferContentType(filename);
  let pres: PresignedUrlResponse;
  try {
    pres = await presign("PUT", filename, ct);
  } catch (err: any) {
    return errorResult(`presign PUT failed: ${err?.message ?? err}`);
  }
  const putRes = await fetch(pres.url, {
    method: "PUT",
    headers: { "Content-Type": ct },
    body: content,
  });
  if (!putRes.ok) {
    const body = await putRes.text();
    return errorResult(`S3 PUT ${putRes.status} ${putRes.statusText}: ${body.slice(0, 500)}`);
  }
  return ok(
    `Saved ${pres.keyFull}\n  size: ${content.length} bytes\n  content-type: ${ct}\n  ` +
    `(load later with load_analysis filename="${filename}")`,
  );
}

async function listSavedAnalyses(prefix?: string) {
  const url = new URL(`${API_URL}/api/admin/analytics/s3/list`);
  if (prefix) url.searchParams.set("prefix", prefix);
  const res = await fetch(url.toString(), {
    headers: { "Authorization": `Bearer ${API_TOKEN}`, "x-tenant": TENANT_ID },
  });
  const text = await res.text();
  if (!res.ok) {
    return errorResult(`Backend ${res.status} ${res.statusText} on list: ${text}`);
  }
  const body = JSON.parse(text) as ListResponse;
  if (body.count === 0) return ok("(no saved analyses)");
  const lines = body.objects.map((o) =>
    `  ${o.key.padEnd(48)}  ${String(o.size).padStart(10)} bytes  ${o.lastModified ?? "-"}`,
  );
  return ok(`${body.count} saved analyses:\n${lines.join("\n")}`);
}

async function loadAnalysis(filename: string) {
  let pres: PresignedUrlResponse;
  try {
    pres = await presign("GET", filename);
  } catch (err: any) {
    return errorResult(`presign GET failed: ${err?.message ?? err}`);
  }
  const fetchRes = await fetch(pres.url);
  if (!fetchRes.ok) {
    const body = await fetchRes.text();
    return errorResult(`S3 GET ${fetchRes.status} ${fetchRes.statusText}: ${body.slice(0, 500)}`);
  }
  const body = await fetchRes.text();
  return ok(body);
}

function inferContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "json": return "application/json";
    case "csv": return "text/csv";
    case "md":
    case "markdown": return "text/markdown";
    case "txt": return "text/plain";
    case "html": return "text/html";
    case "pdf": return "application/pdf";
    case "yaml":
    case "yml": return "application/yaml";
    default: return "application/octet-stream";
  }
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
const profileTag = profileKey ? ` profile=${profileKey}` : "";
console.error(`cloudshops-mcp-analytics ready: ${API_URL} tenant=${TENANT_ID}${profileTag}`);
