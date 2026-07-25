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

## Known instrumentation gaps

These are what the ⚠️ section currently reports on dev, and each is a real fix
worth making — the tool is only as good as the capture underneath it.

1. **Admin/build events carry no `distinctId`.** `build_reported`,
   `deployment_status_updated`, `flag_created`, `flag_updated` and the key-creation
   events record no actor, so they cannot appear in a funnel or in per-user usage.
   The activation funnel reads 0 at the build step for this reason, not because
   nobody builds.
2. **Some `waitlist_signup` events carry no `accountId`.** Anything scoped by
   tenant — including the in-product Analytics tab — cannot see them.
3. **`leads` and `waitlist_signup` disagree.** Leads captured before the warehouse
   existed have no matching event, so campaign attribution undercounts.
4. **`activeUsers` mixes audiences.** Anonymous landing visitors (`gl_vid` cookie)
   and logged-in users are both "distinct actors". Do not quote the number as
   product DAU without saying which is which.

## Extending it

Add a query to the services under `src/services/analytics/`, test-first
(`CLAUDE.md`, red/green/blue). The CLI is a thin wire over `InsightsService`;
prefer growing the service so both the CLI and any future UI get the capability.
