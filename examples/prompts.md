# Sample prompts

Things you can ask once the plugin is installed. The LLM will pick the
right tables, write SQL, run it, and summarise. You don't need to know
SQL or the schema — just ask in plain language.

## Customers (B2B firms)

- *"Show me my top 10 customer firms by spend in the last month."*
- *"Which customer firms have stopped ordering despite a regular pattern?"*
- *"Find duplicate customer firms — same phone, same GST, or same address."*
- *"How many of my approved firms have never placed a single order?"*
- *"Show firms onboarded more than 90 days ago that have ordered ≤2 times."*

## Sales reps / staff

- *"Who is my top sales rep last month?"*
- *"Which sales rep is leaking accounts — i.e. their customers' orders dropping fastest?"*
- *"How balanced is the staff workload — how many firms each rep is handling right now?"*
- *"Which customer firms have no rep assigned?"*

## Products

- *"What are the best-selling products in the last 30 days, by units?"*
- *"Trend the top products month by month for the last 6 months."*
- *"For my top sales rep, what SKUs are they pulling repeatedly?"*

## Geography

- *"Pincode delivery hotspots in the last 7 days."*
- *"Which areas is rep X covering, and how is revenue distributed?"*

## Operations (delivery / payments / returns)

- *"Today's cash-vs-UPI collection by delivery agent."*
- *"Which agents had the highest return rate this week?"*
- *"Trips that closed late vs SLA — last 30 days."*

## Saving & retrieving

- *"Save the top-customers analysis as `reports/top-customers-april.md`."*
- *"List analyses saved this month."*
- *"Load `reports/top-customers-april.md` and continue analysing it."*

## Tips

- The LLM will call `describe_schema` first in a fresh conversation — that
  burns ~3K tokens but means subsequent queries are correct on first try.
- Ask follow-ups in the same chat. The LLM remembers what tables it just
  used and won't re-fetch the schema.
- For sensitive analyses you'll share externally, ask for "aggregated"
  or "PII-free" results — the schema reference flags PII columns and the
  LLM will avoid them when asked.
- If a query returns 10,000 rows with `truncated: true`, ask the LLM to
  add a tighter `WHERE` filter or a `LIMIT` rather than trying to page.
