# Cloudshops Analytics — Bug List

Found while testing the `cloudshops-analytics` MCP plugin against the Cloudshops staging environment (profile `dinasi-stage`, tenant `mcs-prod`). All queries run via `run_sql`. Today: 2026-05-04.

Bugs are ordered roughly by severity (data correctness → operational gaps → cosmetic).

---

## Fix tracking — 2026-05-04 update

After reading the actual ETL code, most "ETL bugs" turned out to be writer-side (mobile app emits a different JSON shape than the parser expected) or expected-NULL-by-design (mobile-app orders never carry a `staff_user_id`). The team chose **not** to change the mobile app; fixes land on the ETL side.

| Defect | Resolution | Where the fix is |
|---|---|---|
| SEV-3 #12 — tenant label `mcs-stage` vs `mcs-prod` | **Shipped** in plugin v0.4.2 | `cloudshops-claude-plugin` `a0d774d` |
| SEV-1 #2 — line-item `unit_price`/`total_price` NULL | **Queued** — parser now reads the `{amount, currency}` object shape the app emits | `bootstrapped` dinasi branch |
| SEV-1 #3 — `staff_user_id` NULL | **Queued** — derived via territory join (`staff_customer_account_association` active at `creation_date` → `staff.current_user_id`); no longer reads `purchase.staff_user_id` | `bootstrapped` dinasi branch |
| SEV-2 #5 — `coupon_code` "AC2301", `discount_amount` 0 | **Queued** — parser reads from `billSummary.coupon.couponCode/discountAmount` first; falls back to legacy `discount.code` only if non-placeholder | `bootstrapped` dinasi branch |
| SEV-3 #11 — `product_name`, `product_code`, `image_link` NULL | **Queued (full)** — `product_name` reads JSON's `productName`/`name`/`itemName` then falls back to `toy.name`; `product_code` falls back to `toy.code`; `image_link` falls back to `toy.thumbnail` then first `photo_links` entry. Pre-loaded once per run, no N+1. | `bootstrapped` dinasi branch (commit 8fcb25d) |
| SEV-3 #9 — `primary_category_name` NULL | **Queued** — `DimToyLoader` now pre-loads the `ty_categories` tree and `toy_categories` edges, walks `parent_id` to find each toy's leaf category, and writes `primary_category_id` / `primary_category_name`. Tested with 12 cases (empty/null, single category, sibling branches, ties, unknown ids, cycles, orphans). | `bootstrapped` dinasi branch (commit 8fcb25d) |
| SEV-2 #6 — `delivery_charge_amount` NULL | **Still not addressed.** Mobile app's `billSummary` doesn't emit `deliveryCharge`. ETL parser already looks for it; will populate as soon as the writer adds it. | Backlog (writer-side) |
| SEV-1 #1 — warehouse 9 days stale | **Likely operational** — scheduler is wired (`AnalyticsLoadScheduledTask` cron `0 0 0 * * *` IST), loaders are correct. Two genuine ETL bugs were already fixed in `d98f4be` (Apr 30) but not deployed: `DimCustomerLoader` empty-load and `FactStaffCustomerAccountAssignmentLoader` ClassCastException. Most likely causes for the Apr-25 cutoff: (a) source `purchase` table has no rows since Apr 25, or (b) deployed backend hasn't picked up the d98f4be fix and one loader is throwing. | Verify on deploy + DB |
| SEV-2 #4 — delivery tables empty/sparse | **Likely operational** — loaders are correct. `delivery_payment_collection` (9 rows) and `delivery_delivery_return` (2 rows) most likely have similarly few rows in the source. | Verify in source DB |
| SEV-2 #7 — `payment_gateway` NULL | **Not addressed** — source `purchase.payment_gateway` column is NULL on every row; needs order-creation/payment-completion side fix. | Backlog |
| SEV-3 #8 — `not_available` semantics | **Source data quality** — loader passes `t.not_available` through verbatim. | Source cleanup, separate from ETL |
| SEV-3 #9 — `primary_category_name` NULL | **Known v1 deferral** — `DimToyLoader.java:23-26` comment: "needs schema verification before we wire it up. Tracked as a v2 enrichment." | v2 work |
| SEV-3 #10 — `brand` contains SKU descriptors | **Source data quality** — loader passes `t.brand` through verbatim. | Source cleanup |
| SEV-3 #11 partial — `product_code`, `image_link` NULL | **Not addressed** — mobile app doesn't emit these keys; team chose not to change the app. | Backlog |

**What needs to happen for queued items to take effect:**

1. Deploy `bootstrapped` dinasi branch (HEAD currently the parser+staff-attribution commit).
2. After next nightly ETL run (cron `0 0 0 * * *` IST), the 7-day lookback re-loads recent rows with the new logic. Historical rows older than 7 days will still have the old NULL values until a manual backfill — re-run with a wider lookback or full reload via the manual trigger endpoint.

**Caveat on the new `staff_user_id` semantics:**

Previously the schema reference said "`staff_user_id` NULL = customer self-service". With territory-based derivation, NULL now means "the customer's firm had no rep assigned at the order's creation date." There's currently no signal to distinguish self-service from rep-driven, since the source column was always NULL anyway. If that distinction matters for analytics, the order-creation path on the backend would need to start populating `purchase.staff_user_id` directly when a rep places an order on behalf of a customer.

---

## SEV-1 — Data freshness: warehouse is 9+ days stale

```sql
SELECT MAX(creation_date) FROM fact_purchase;
-- → 2026-04-25T11:27:50.475   (today is 2026-05-04)
```

No orders ingested for the last 9 days across **every** large fact table:

| Table | Latest row |
|---|---|
| `fact_purchase` | 2026-04-25 |
| `fact_purchase_item` | 2026-04-25 |
| `fact_delivery_trip` | 2026-04-28 |
| `fact_payment_collection` | 2026-02-05 (3 months stale!) |
| `fact_delivery_return` | 2026-02-05 (3 months stale!) |

**Impact:** every "last 30 days" question is silently using a 30-day window ending April 25, not today. Anyone making business decisions from this is reading stale data.

**Fix:** investigate the ETL ingestion job. It either stopped at Apr 25 (orders/items/trips) or never started for some sources (payments/returns).

---

## SEV-1 — `fact_purchase_item.unit_price` and `total_price` are 100% NULL

```sql
SELECT COUNT(*), COUNT(unit_price), COUNT(total_price)
FROM fact_purchase_item;
-- → 50,846 rows | 0 with unit_price | 0 with total_price
```

Every line item ever loaded has NULL prices. Confirmed via `SELECT *` — no hidden price column.

**Impact:** revenue **cannot** be computed at the product or line-item level. Top-products-by-revenue, margin analysis, basket-value-by-product — all blocked.

**Fix:** the JSON parser that builds `fact_purchase_item` must extract `unit_price` and `total_price` from the source order JSON. `quantity` and `toy_id` come through, so it's specifically the price extraction.

---

## SEV-1 — `fact_purchase.staff_user_id` is 100% NULL

```sql
SELECT COUNT(*), COUNT(staff_user_id) FROM fact_purchase;
-- → 25,058 orders | 0 with staff_user_id
```

The schema doc says "NULL = customer self-service", which would imply this business runs 100% self-service — but it has 18+ FSEs (Field Sales Executives) and an institutional sales role, and the assignment table has 1,830 active rep-firm relationships. So this is almost certainly an ETL bug, not a real business state.

**Impact:** can't attribute orders to a specific rep ("did this rep help place the order?") — only territory ownership via `fact_staff_customer_account_assignment`. Self-service vs rep-driven slicing is impossible.

**Fix:** parse `staff_user_id` from the order payload.

---

## SEV-2 — Delivery operations tables are barely loaded

| Table | Total rows | Date span |
|---|---|---|
| `fact_delivery_trip` | **7** | 2026-04-26 → 2026-04-28 (3 days) |
| `fact_payment_collection` | **9** | 2026-01-17 → 2026-02-05 |
| `fact_delivery_return` | **2** | 2026-02-01 → 2026-02-05 |

Versus 25,058 rows in `fact_purchase` over the same overall period. These tables look like one-off backfills, not running pipelines.

Additionally, on the 7 trip rows that do exist, the **rollup columns are all zero**:
```
trips=7  orders_attached=69  orders_delivered=0  orders_returned=0
orders_failed=0  total_collection_amount=0  total_return_amount=0
```

**Impact:** all delivery-ops analytics blocked — cash/UPI/card mix, delivery success rate, returns rate, agent-level collection, driver payouts.

**Fix:** wire up the ETL for these three tables (and populate the rollup columns on `fact_delivery_trip`).

---

## SEV-2 — `discount_amount` always 0, `coupon_code` shows the same value on 99.96% of orders

```sql
SELECT coupon_code, COUNT(*), SUM(discount_amount)
FROM fact_purchase
WHERE creation_date >= NOW() - INTERVAL 30 DAY
GROUP BY coupon_code;
-- → AC2301 | 2805 uses | 0 total discount
--    NULL  |    1 use  | 0
```

`AC2301` appears on 2,805 of 2,806 recent orders — that's not coupon usage, that's a default tag or a misnamed column (looks more like an account/agent code than a discount coupon). And the discount amount is always 0 even though the column is populated.

**Impact:** cannot answer "which coupons drive revenue", "what's our discount-to-revenue ratio", "are reps over-discounting", etc.

**Fix:** verify what `coupon_code` is actually mapping from in the source. If it's a coupon, populate `discount_amount`. If it's an "agent code" or similar, rename.

---

## SEV-2 — `fact_purchase.delivery_charge_amount` is 100% NULL

```sql
COUNT(delivery_charge_amount) over last 30d = 0 / 2806
```

**Impact:** can't analyse delivery cost recovery, free-delivery-threshold effectiveness, or delivery margin.

**Fix:** parse from order JSON.

---

## SEV-2 — `fact_purchase.payment_gateway` is 100% NULL

```sql
COUNT(payment_gateway) over last 30d = 0 / 2806
```

`payment_status` is populated, but the gateway field never is.

**Impact:** can't slice by COD vs prepaid vs UPI vs card at the order level. (And we can't fall back to `fact_payment_collection` because it has 9 rows total — see SEV-2 #1.)

**Fix:** parse from order JSON.

---

## SEV-3 — `dim_toy.not_available` semantics are inverted or broken

```sql
SELECT COUNT(*), SUM(active=1), SUM(not_available=1) FROM dim_toy;
-- → 522 toys | 522 active | 507 not_available
SELECT COUNT(DISTINCT toy_id) FROM fact_purchase_item
WHERE order_creation_date >= NOW() - INTERVAL 30 DAY;
-- → 347 distinct products sold in 30 days
```

97% of catalog is marked `not_available = 1`, yet 347 distinct products were sold in the last 30 days alone. Either the column's semantics are flipped (perhaps `not_available=1` actually means "available"?), the column is being populated from the wrong source field, or it's stale.

**Impact:** any "out-of-stock" or "catalog availability" report is wrong. Anyone trusting `not_available` for inventory decisions will misread the catalog.

**Fix:** investigate the source mapping for this column.

---

## SEV-3 — `dim_toy.primary_category_name` is 100% NULL

```sql
COUNT(primary_category_name) = 0 / 522
```

The schema doc warns ("may be NULL in v1") but it's universally NULL.

**Impact:** no category-level rollups possible — top categories, category mix, category margin, etc.

**Fix:** join through to the source category dimension when building `dim_toy`.

---

## SEV-3 — `dim_toy.brand` contains SKU descriptors, not brands

Examples seen in real top-N output:

| Product | brand value |
|---|---|
| Maida | `Roxy Mobile` |
| Sona Masuri Steam Rice | `Jai Jawan Jai Kissan Royal Bullet` |
| RNR Steam Rice | `Aishwarya Royal Bullet Medium DD` |
| Urad Dal | `Tenali Maharaja` |

These look like full SKU descriptions or unrelated strings, not brand names.

**Impact:** brand-level rollups are misleading.

**Fix:** review the source field that's mapped to `brand`.

---

## SEV-3 — `fact_purchase_item.product_name`, `product_code`, `image_link` are NULL

The line-item table denormalises these from `dim_toy` for performance, but they're all NULL. Queries currently have to join through `dim_toy` to get a name, which works but defeats the denormalisation.

**Impact:** minor — a working join exists. But every query is slower than it needs to be.

---

## SEV-3 — `describe_schema` reports the wrong tenant scope label

The tool's output says "scoped to tenant **mcs-stage**", but the actual `tenant_id` on every row in the staging environment is `mcs-prod` (which is the correct/expected value per the user — staging stores data under the `mcs-prod` tenant name by design).

**Impact:** cosmetic, but misleading. If the server is also using the `mcs-stage` string for tenant filtering anywhere, that filter is misconfigured.

**Fix:** in `dinasi-stage` profile, the schema-doc text and any internal tenant filter should both report `mcs-prod`.

---

## What works correctly (so we know the scope of the fix)

- Order-level revenue (`fact_purchase.total_amount` / `amount`) — populated, accurate-looking
- Order-level `subtotal_amount`, `tax_amount`, `payment_status`, `delivery_pincode`, `delivery_city` — all populated
- Customer firm dimension (`dim_customer_account`) — populated, sensible PII redaction in place
- Customer person dimension (`dim_customer`) — populated
- Staff dimension and assignment fact — populated, 1,830 active rep-firm relationships, only 29 firms unassigned
- Product top-N by units, customer firm top-N by spend, dormancy/churn analysis — all return sensible numbers
- `run_sql` performance is good (sub-100ms on aggregate queries against 25k–50k row tables)
- `describe_schema` returns a thorough business-glossary doc (apart from the tenant-name typo)

---

## Test status

- [x] Plugin install + auth working
- [x] `describe_schema` returns full reference
- [x] `run_sql` works for order-level aggregate queries
- [x] Customer-firm spend ranking, dormancy/churn list — working
- [x] Top products by units (last 10d / 30d) — working
- [x] Sales rep performance via territory join — working
- [x] **Tenant scope label** — fixed in plugin v0.4.2
- [x] **Top products by revenue** — parser fix queued (deploy + nightly run will populate)
- [x] **Sales rep attribution** — territory-based derivation queued (deploy + nightly run will populate)
- [x] **Coupon analytics** — parser fix queued (`coupon_code`, `discount_amount` will populate when the `coupon` block is present in the JSON)
- [x] **Product name / code / image link denormalisation** — line items now fall back to `toy.name` / `toy.code` / `toy.thumbnail` (or first `photo_links` entry) when the JSON doesn't carry them
- [x] **Category rollups (primary)** — `dim_toy.primary_category_id` / `primary_category_name` now populated with the leaf category from the `ty_categories` hierarchy walk
- [ ] **Real-time / yesterday's numbers** — blocked on operational verification (most likely cause is no source orders since Apr 25)
- [ ] **Delivery success rate, returns rate, payment-mode mix** — likely operational (source tables sparse)
- [ ] **Delivery charge / payment-gateway slicing** — writer-side gap; ETL parser already reads them when present
- [ ] **Catalog availability** — `not_available` semantics are source data quality, not ETL
- [ ] **Brand rollups** — `dim_toy.brand` is correctly populated from `toy.brand`; the SKU-descriptor values are source data quality
