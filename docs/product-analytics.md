# Internal product & marketing analytics

The in-product Analytics tab shows a tenant their own event trends. This is the
other half: the **internal** reporting the team uses to decide what to build and
what to promote. Same warehouse (`analytics_events`), different questions.

```bash
yarn analytics                    # last 30 days against $MONGODB_URI
yarn analytics --days 7 --json
```

Full option list and interpretation guidance live in the
`product-analytics` skill (`.claude/skills/product-analytics/SKILL.md`), which
lets Claude answer these questions directly.

## What it answers

| Question                      | Section             | Source                              |
| ----------------------------- | ------------------- | ----------------------------------- |
| Which campaign drove signups? | Marketing campaigns | UTM props on `waitlist_signup`      |
| Did the A/B test win?         | A/B experiments     | `flag_exposure` + `flag_conversion` |
| How is the product used?      | Product usage       | all `track` events                  |
| Can I trust these numbers?    | ⚠️ Data quality     | reconciliation checks               |

Experiment verdicts come from a two-proportion z-test (`significance.ts`), not
from eyeballing conversion rates. An undecided experiment reports how much more
traffic each arm needs rather than hinting at a trend — with the volumes we have
today, that distinction is the whole point.

## Attribution rules

Every event carries **who** and **which tenant**. Mutating routes pass an
`AnalyticsContext` built by `actor()` (`src/services/analytics/actorIdentity.ts`);
an event without one is invisible to the dashboard and cannot appear in a funnel,
so the ⚠️ section calls it out rather than letting it read as a quiet zero.

`distinctId` carries three different kinds of actor, told apart by shape:

| Shape         | Kind              | Example                      |
| ------------- | ----------------- | ---------------------------- |
| `apikey:<id>` | machine           | CI reporting a build         |
| 24-char hex   | product user      | a logged-in person           |
| UUID          | anonymous visitor | landing page `gl_vid` cookie |
| anything else | unidentified      | `lead:<id>`, emails          |

This is why the briefing headlines **product users** and itemises everyone else
separately: a landing-page traffic spike must never read as product growth.

## Reconciling leads with the warehouse

`leads` is the source of truth for "someone joined the waitlist". Signup events
are now stamped with `properties.leadId`, so the two can be reconciled exactly.
For rows written before that stamp existed:

```bash
yarn analytics:backfill                  # dry run — prints what it would do
yarn analytics:backfill --apply          # writes
```

It creates a signup event for any lead the warehouse never recorded, and fills
in a missing `accountId`/`distinctId` on events that predate the fix. Matching
prefers the `leadId` stamp and falls back to timestamp proximity, so re-running
it is a no-op.

## Known gaps

- **Historical rows need the backfill above.** Until it runs against an
  environment, that environment's campaign attribution undercounts.
- **`waitlist-hero-copy` is configured in `dev` only** — `prod` has no variants,
  so the live landing page is not running the experiment.

## Extending it

Add a query to the services under `src/services/analytics/`, test-first
(`CLAUDE.md`, red/green/blue). The CLI is a thin wire over `InsightsService`;
prefer growing the service so both the CLI and any future UI get the capability.
