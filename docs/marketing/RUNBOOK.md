# Marketing Operating Runbook

How to launch a campaign, read the results, and run a landing-copy experiment if
you start another one.

Companion docs: **[README.md](./README.md)** (UTM convention, bot protection) and
**[CAMPAIGNS.md](./CAMPAIGNS.md)** (the campaign register).

---

## 1. Launching a campaign

A "campaign" is not a database record — there is no campaign model and no admin
UI. It is a UTM-tagged URL plus a row in the register.

1. **Pick an angle** from the positioning canvas (visibility / anyone-can-ship /
   one-click-rollback / no-platform-team). Don't invent claims.
2. **Mint the tagged URL** with the `/campaign-url` skill rather than
   hand-writing it — hand-written links are how the first send ended up split
   across two rows (see the drift note in [CAMPAIGNS.md](./CAMPAIGNS.md)).

   ```
   https://gitlaunch.dev/?utm_source=hn&utm_medium=post&utm_campaign=alpha-launch&utm_content=fear-angle
   ```

3. **Add a row to [CAMPAIGNS.md](./CAMPAIGNS.md) before you send the link.**
   Hypothesis, tagged URL, status.
4. **Ship it**, then flip the row's status and keep the signup count current.

Untagged links are invisible in the data. Attribution is captured from the query
string on landing, mirrored into `sessionStorage` so it survives an in-session
bounce, and denormalized onto the lead — stored **without** the `utm_` prefix as
`source`, `medium`, `campaign`, `content`, `term`, `referrer`, each trimmed and
capped at 200 characters.

Keep the two axes separate: `utm_content` is the _outbound creative you sent_; a
flag variant is the _landing copy the visitor was served_. `utm_content` cannot
steer the on-page variant, and using it that way confounds both.

---

## 2. Reading the data

### Campaign performance

`waitlist_signup` and `waitlist_bot_blocked` are filed under the account that
owns `GITLAUNCH_SERVICE_ID`, with the visitor's `gl_vid` as the distinct id — so
they appear on **`/dashboard/analytics`**, and a signup lines up with that
visitor's flag exposure.

**This depends on `GITLAUNCH_SERVICE_ID` being set and resolvable.** Every
analytics query is account-scoped, so if it is unset or points at a missing
service, events are still written but belong to no tenant and no query returns
them. It is logged at boot — check the startup line before concluding a campaign
underperformed. Lead capture is unaffected either way.

For the internal cross-channel report:

```bash
yarn analytics --days 30
```

For a breakdown neither offers, leads land in the `leads` collection with full
attribution, indexed on `attribution.campaign`:

```js
db.leads.aggregate([
  {
    $group: {
      _id: { campaign: "$attribution.campaign", source: "$attribution.source" },
      signups: { $sum: 1 },
    },
  },
  { $sort: { signups: -1 } },
]);
```

### Experiment performance

The **Results** panel on the flags page shows one section per environment, each
with its own verdict — `Ship <variant>`, `Keep <baseline>`, `Keep running`, or
`Nothing to compare`. Verdicts come from a two-proportion z-test, and an arm
that leads without enough traffic reads `Keep running` with the sample size it
still needs, rather than inviting you to stop at a lucky peek. Details in
[feature-flags.md](../feature-flags.md).

---

## 3. Running a landing-copy experiment

The `waitlist-hero-copy` experiment has **concluded** — `benefit-led` is the
single shipped copy and exposure tracking is off. See
[README.md](./README.md#landing-page-ab-test--concluded) for why, and check your
traffic supports a test before starting another. At a few hundred visits a week,
copy questions are answered faster by talking to people than by splitting them.

To start another arm:

1. Add the copy object to `VARIANT_COPY` in
   `src/services/marketing/waitlistExperiment.ts`. **The copy lives in code**;
   the flag only stores variant keys and weights, so a variant with no copy
   silently serves the shipped version.
2. On `/services/<serviceId>/flags`, add the variant key and weights to
   `waitlist-hero-copy`, and make sure the flag is **enabled** for that
   environment.
3. Set `GITLAUNCH_FLAG_ENV` to the environment you configured.

Bucketing is deterministic sha256 over the `gl_vid` visitor cookie, so a visitor
always lands in the same arm. Conversions re-resolve the variant server-side from
that cookie, never from the form, so they cannot be spoofed or land on the wrong
arm.

**Targeting rules cannot help you QA.** The experiment evaluates with empty
attributes, so no rule can match an anonymous visitor. To see a specific arm,
clear `gl_vid` and reload, or temporarily weight that variant at 100.

### Testing it locally

```bash
ANALYTICS_WAREHOUSE=true    # required, and must be the literal string "true"
GITLAUNCH_SERVICE_ID=<objectid>
GITLAUNCH_FLAG_ENV=prod
```

```bash
yarn dev   # http://localhost:3050
```

Open `/` in a **private window** — a logged-in session redirects to `/dashboard`
and never mints a cookie. Then submit the waitlist form, waiting **at least 2.5
seconds** first.

```bash
yarn vitest --run \
  src/services/marketing/waitlistExperiment.test.ts \
  src/services/flag/experimentResultsService.test.ts \
  src/server/routes/marketing/waitlist.test.ts \
  src/server/routes/settings/flags.test.ts
```

---

## 4. Gotchas that will waste your afternoon

| Symptom                                        | Cause                                                                                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Signup "succeeds" but no lead is created       | You submitted in under **2500 ms**. Bot detection blocks it and still renders the **success** partial, deliberately, so bots get no oracle. Honeypot hits likewise |
| Second signup from the same email does nothing | Dedupe is idempotent by lowercased email and attribution is **first-touch** — never overwritten, no events re-emitted                                              |
| Results panel empty forever                    | `ANALYTICS_WAREHOUSE` isn't the literal `"true"`. Off in production is a no-op that **silently drops events**; off in dev logs to console only                     |
| Campaign events missing from the dashboard     | `GITLAUNCH_SERVICE_ID` unset or pointing at a missing service. Events are written but belong to no tenant                                                          |
| A new variant serves the shipped copy          | Its key has no entry in `VARIANT_COPY`. The flag alone cannot introduce copy                                                                                       |
| Our own tests inflate the numbers              | Set `ANALYTICS_INTERNAL_EMAILS` / `ANALYTICS_INTERNAL_ACTORS` (see [README.md](./README.md))                                                                       |

> `GITLAUNCH_SERVICE_ID` also exists as a GitHub Actions repo variable used to
> build the build-reporting URL in `ci.yml` / `deploy.yml`. Same name, unrelated
> purpose, and the Actions variable does **not** reach the running server — set
> it on the Railway service too.

---

## 5. Production checklist

- [ ] `ANALYTICS_WAREHOUSE=true` in Railway — otherwise events are silently dropped and you collect nothing.
- [ ] `GITLAUNCH_SERVICE_ID` set to GitLaunch's own service id, on the **app**, not just in CI.
- [ ] `ANALYTICS_INTERNAL_EMAILS` / `ANALYTICS_INTERNAL_ACTORS` set so our own traffic stays out of acquisition reporting.
- [ ] Verified in incognito on `https://gitlaunch.dev` that a `gl_vid` cookie is set, a real signup lands in `leads`, and the same signup appears on `/dashboard/analytics`.
- [ ] Campaign rows added to `CAMPAIGNS.md` with tagged URLs before any link goes out.
- [ ] If running an experiment: decide the stopping rule before launching, and confirm the flag is enabled with weights in the environment `GITLAUNCH_FLAG_ENV` names.
