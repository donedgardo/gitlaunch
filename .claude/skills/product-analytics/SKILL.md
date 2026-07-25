---
name: product-analytics
description: Answer questions about GitLaunch's own marketing campaigns, A/B test results, and product usage from the analytics warehouse. Use when asked how a campaign performed, whether an experiment has a winner, what UTM source drove signups, how many people are active, which features are used, or where users drop out of the funnel.
---

# Product analytics

Answers marketing and product questions from the `analytics_events` warehouse
using the repo's own query layer — never by hand-rolling aggregations.

## Getting the data

```bash
yarn analytics                                  # last 30 days, markdown briefing
yarn analytics --days 7                         # shorter window
yarn analytics --from 2026-07-01 --to 2026-07-25
yarn analytics --json                           # machine-readable, for filtering
yarn analytics --account <objectId>             # scope product usage to one tenant
yarn analytics --interval week                  # weekly active users
yarn analytics --funnel user_logged_in,build_reported
```

Connection comes from `MONGODB_URI` (or `--uri`). The script is **read-only**.
Point it at whichever environment the question is about — a dev URI answers
questions about dev traffic, not production.

Prefer `--json` when the question is narrow (one campaign, one flag); prefer the
default markdown when the user wants a briefing they can read or paste.

## Answering the three question families

**"How did campaign X do?"** → the Marketing campaigns table. Rows are
`campaign × source × medium` from UTM properties on `waitlist_signup` events.
`(direct)` / `(none)` mean the visitor arrived untagged. `Signups` counts events;
`Unique` counts distinct visitors, so a double form submission shows as 2 / 1.
Use `/campaign-url` to mint properly tagged links so future traffic is attributable.

**"Did the A/B test win?"** → the A/B experiments section. Each running
experiment gets a verdict:

- `ship <variant>` — it beat control significantly (p < 0.05, two-proportion z-test)
- `keep control` — every challenger lost significantly
- `keep running` — nothing has separated yet; the line states how many more
  entities **per arm** are needed to detect a 20% relative change
- `nothing to compare` — only one arm ever got traffic

Never call a winner from raw conversion rates alone. If the verdict says keep
running, say that, and quote the shortfall rather than implying a trend.

**"How is the product being used?"** → Active users, Feature adoption and the
activation funnel. `activeUsers` counts every distinct actor, which includes
**anonymous landing-page visitors** (a `gl_vid` cookie id), not just logged-in
users — do not quote it as product DAU without saying so. Feature adoption
splits reach (`Users`) from volume (`Occurrences`).

## Read the data-quality section first

The briefing opens with `⚠️ Data quality` when something makes the numbers
untrustworthy. Always factor these into the answer instead of quoting the
tables as fact:

- events with **no `accountId`** are invisible to every tenant-scoped dashboard query
- **`leads` vs `waitlist_signup` mismatch** means campaign attribution is undercounting
- events with **no `distinctId`** inflate volume while contributing nothing to
  funnels or per-user usage — a funnel step reading 0 is usually this, not a
  real drop to zero

## How the pieces fit

| File                                                 | Role                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| `scripts/analytics-report.ts`                        | CLI entry point                                                         |
| `src/services/analytics/insightsService.ts`          | composes the briefing, discovers running experiments, collects warnings |
| `src/services/analytics/campaignAnalyticsService.ts` | UTM attribution over `waitlist_signup`                                  |
| `src/services/analytics/productUsageService.ts`      | active users, feature adoption, funnels                                 |
| `src/services/analytics/experimentAnalysis.ts`       | baseline pick, verdict, traffic shortfall                               |
| `src/services/analytics/significance.ts`             | two-proportion z-test, sample sizing                                    |
| `src/services/flag/experimentResultsService.ts`      | per-variant exposure/conversion tallies                                 |

Experiments are discovered from `flag_exposure` events, so an experiment shows
up whenever it has traffic — a flag existing in the UI is not enough, and a
deleted flag still reports its history.

To answer something the CLI does not cover, extend these services with a test
first (see `CLAUDE.md` — red/green/blue is mandatory) rather than querying
Mongo ad hoc.
