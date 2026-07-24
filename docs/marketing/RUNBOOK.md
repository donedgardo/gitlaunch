# Waitlist A/B Test — Operating Runbook

How to test the landing-page A/B experiment (PR #10), launch a marketing campaign, and read the results.

Companion docs: **[README.md](./README.md)** (UTM convention, bot protection) and **[CAMPAIGNS.md](./CAMPAIGNS.md)** (the campaign register).

---

## 1. What PR #10 actually shipped

GitLaunch dogfoods its own feature-flag engine to A/B test the alpha-waitlist landing hero copy, using waitlist signups as the conversion goal.

| Piece            | Value                                                                      | Source                                            |
| ---------------- | -------------------------------------------------------------------------- | ------------------------------------------------- |
| Flag key         | `waitlist-hero-copy` — **hardcoded**, not env-configurable                 | `src/services/marketing/waitlistExperiment.ts:22` |
| Variants         | `control`, `benefit-led`                                                   | `waitlistExperiment.ts:61-64`                     |
| Visitor cookie   | `gl_vid` — random UUID, httpOnly, sameSite lax, 1-year TTL                 | `src/server/home/index.ts:27-37`                  |
| Exposure event   | `flag_exposure`, emitted on `GET /` render                                 | `waitlistExperiment.ts:159-179`                   |
| Conversion event | `flag_conversion`, goal `waitlist_signup`, emitted on genuinely-new signup | `waitlistExperiment.ts:181-202`                   |
| Copy lives in    | **Code**, not the flag. The flag only stores variant keys + weights.       | `waitlistExperiment.ts:41-64`                     |

Two safety properties worth knowing:

- **Control copy === today's live page.** A disabled, missing, or misconfigured flag is a no-op that renders the current landing page. Every failure path falls back to control (reasons: `unconfigured`, `missing`, `error`).
- **Conversion variant is re-resolved server-side** from the `gl_vid` cookie on submit — it is never read from the form, so it can't be spoofed.

### Not shipped — read this before looking for it

The "Connect an app" card and the least-privilege `flags:read`-only key endpoint (`POST /services/:serviceId/flags/keys`) are described in the PR #10 description but **did not merge**. They live in commit `478760a` on `origin/worktree-wishlist-flag-dogfood`, which is not an ancestor of `main`.

Until that lands, the only way to mint a flag-reading API key is the account-wide generator at **`/settings/api-keys`**, which grants all 7 scopes (`builds:read/write`, `deployments:write`, `services:read/write`, `flags:read/write`). Treat those keys as privileged.

---

## 2. Testing it locally

### 2.1 Configure

In `.env`:

```bash
MONGODB_URI="mongodb://localhost:27017"
ANALYTICS_WAREHOUSE=true          # REQUIRED — see gotcha below
GITLAUNCH_SERVICE_ID=<objectid>   # blank => experiment inert, always control
GITLAUNCH_FLAG_ENV=prod           # must match the flag env you configure
```

`GITLAUNCH_SERVICE_ID` is GitLaunch's own service _inside_ GitLaunch — the scope its dogfood flags live under. Get the id from the flags page URL: `/services/<this-part>/flags`. The owning account is derived from the service; there is no account-id variable.

> **Name collision:** `GITLAUNCH_SERVICE_ID` is also used as a GitHub Actions variable in `ci.yml` / `deploy.yml` for build reporting. Same name, unrelated purpose. Don't assume one value works for both.

### 2.2 Set up the flag

On `/services/<serviceId>/flags`:

1. **Create** the flag with key exactly `waitlist-hero-copy`.
2. **Set variants** for your environment: `control` weight `50`, `benefit-led` weight `50`.
3. **Enable** the flag for that environment (the enabled checkbox — unchecked means off).

Bucketing is deterministic sha256 over the visitor id, so a given `gl_vid` always lands in the same arm.

### 2.3 Exercise the flow

```bash
yarn dev   # http://localhost:3050
```

1. Open `/` in a **private/incognito window**. Logged-in sessions redirect to `/dashboard` and never see the landing page or mint a cookie.
2. Confirm a `gl_vid` cookie was set. Clearing it and reloading re-buckets you — that's how you see the other arm.
3. Submit the waitlist form. **Wait at least 2.5 seconds** before submitting (see gotcha below).
4. Read the results panel: `/services/<serviceId>/flags/waitlist-hero-copy/results`, or the JSON API `GET /api/v1/services/:serviceId/environments/:env/flags/:key/results` (scope `flags:read`).

### 2.4 Automated tests

```bash
yarn vitest --run \
  src/services/marketing/waitlistExperiment.test.ts \
  src/services/flag/experimentResultsService.test.ts \
  src/server/routes/marketing/waitlist.test.ts \
  src/server/routes/settings/flags.test.ts
```

35 tests covering variant resolution, every control fallback, exposure/conversion payloads, cookie-based conversion attribution, and the results panel.

> Running the full `yarn test` in a fresh git worktree fails one unrelated test (`reporterContractDrift`) because `github-action` is a git submodule that isn't initialized there. Run `git submodule update --init` first.

### 2.5 Targeting rules don't apply here

Flag targeting rules (attribute/segment matching) take precedence over the rollout gate and can pin a segment to a specific variant — but **not for this experiment**. `WaitlistExperiment` calls `flags.evaluate(...)` without an attributes argument, so it evaluates with `{}`; a rule only matches an entity that actually carries the attribute it targets, so no rule can ever match an anonymous landing-page visitor.

Practically: you cannot use a targeting rule to force yourself into `benefit-led` for manual QA. Clear the `gl_vid` cookie and reload until you land in the arm you want, or temporarily set that variant's weight to 100.

---

## 3. Gotchas that will waste your afternoon

| Symptom                                          | Cause                                                                                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Signup "succeeds" but no lead, no conversion     | You submitted in under **2500 ms**. Bot detection blocks it and — deliberately, to avoid giving bots an oracle — still renders the **success** partial. Honeypot hits behave the same way. |
| Never see the `benefit-led` variant              | You're logged in (redirected to `/dashboard`), or the flag is disabled, or `GITLAUNCH_SERVICE_ID` is blank/invalid. All fail open to control, silently.                                    |
| Results panel is empty forever                   | `ANALYTICS_WAREHOUSE` isn't `"true"`. Off + production = **NoOp; events are silently dropped**. Off + dev = console only. It must be the literal string `"true"`.                          |
| Results panel shows the wrong environment        | The panel reads `envNames[envNames.length - 1]` — the **last** environment on the service — not `GITLAUNCH_FLAG_ENV`. Make them agree.                                                     |
| Second signup from same email does nothing       | Dedupe is idempotent by lowercased email, and attribution is **first-touch** — it is never overwritten. No events emitted on resubmit.                                                     |
| Unknown variant key renders control              | `VARIANT_COPY[variant] ?? CONTROL_COPY`. Adding an arm in the flag UI without adding its copy in code silently serves control.                                                             |
| Targeting rule has no effect on the landing page | The experiment evaluates with empty attributes, so no rule can match. See §2.5.                                                                                                            |

**Adding a third arm** requires a code change: add the copy object to `VARIANT_COPY` in `waitlistExperiment.ts` _and_ the variant key + weight in the flags UI. The flag alone can't introduce new copy.

---

## 4. Launching a campaign

A "campaign" is not a database record — there is no campaign model and no admin UI. It is a UTM-tagged URL plus a row in the register.

1. **Pick an angle** from the positioning canvas (visibility / anyone-can-ship / one-click-rollback / no-platform-team). Don't invent claims.
2. **Build the tagged URL** using the UTM convention in [README.md](./README.md):

   ```
   https://gitlaunch.dev/?utm_source=hn&utm_medium=post&utm_campaign=alpha-launch&utm_content=fear-angle
   ```

   `utm_source` where the link lives · `utm_medium` placement type · `utm_campaign` slug · `utm_content` creative variant · `utm_term` optional keyword.

3. **Add a row to [CAMPAIGNS.md](./CAMPAIGNS.md) before you send the link.** Hypothesis, tagged URL, status.
4. **Ship it**, then flip the row's status and keep the signup count current.

Untagged links are invisible in the data. Attribution is captured from the query string on landing, mirrored into `sessionStorage` so it survives an in-session bounce, and denormalized onto the lead (fields stored **without** the `utm_` prefix: `source`, `medium`, `campaign`, `content`, `term`, `referrer`; each trimmed and capped at 200 chars).

### Campaign vs. experiment — keep them separate

These are two independent axes and they answer different questions:

- **`utm_content`** — which _outbound creative_ you sent. You control it per link.
- **`waitlist-hero-copy` variant** — which _landing copy_ the visitor was served. The flag controls it, randomly.

Don't use `utm_content` to try to steer the on-page variant; it can't, and you'll confound the test.

---

## 5. Reading the data

Two separate systems. This is the part most likely to confuse.

### A/B variant performance → the flags results panel

`/services/<serviceId>/flags/waitlist-hero-copy/results` — per-variant exposures, conversions, and conversion rate over a fixed **30-day** window, deduped by visitor so each person counts once per variant.

**No statistical significance is computed** anywhere in the codebase — the rate is plain `conversions / exposures`. Judge significance yourself before calling a winner; with alpha-scale traffic, small differences are noise.

### Campaign performance → the analytics dashboard, or a direct Mongo query

`waitlist_signup` and `waitlist_bot_blocked` are filed under the account that owns `GITLAUNCH_SERVICE_ID`, with the visitor's `gl_vid` as the distinct id — the same tenant and the same visitor as the flag exposures above. So campaign events show up on **`/dashboard/analytics`** and a signup can be lined up against that visitor's A/B exposure.

**This depends on `GITLAUNCH_SERVICE_ID` being set and resolvable.** Every `AnalyticsQueryService` query is account-scoped, so if it's unset or points at a service that doesn't exist, the events are still written but belong to no tenant and no dashboard query returns them. That's the same misconfiguration that makes our own flags inert, and it's logged at boot — check the startup line before you conclude a campaign underperformed. Lead capture is unaffected either way.

For a breakdown the dashboard doesn't offer, leads land in the `leads` collection (db `gitlaunch`) with full attribution, indexed on `attribution.campaign`:

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

---

## 6. Production checklist

- [ ] `ANALYTICS_WAREHOUSE=true` in Railway — otherwise events are silently dropped and you will collect nothing.
- [ ] `GITLAUNCH_SERVICE_ID` set to GitLaunch's own service id.
- [ ] `GITLAUNCH_FLAG_ENV` matches the **last** environment on that service (so the results panel reads the same env you're writing).
- [ ] Flag `waitlist-hero-copy` created, variants weighted, **enabled** for that environment.
- [ ] Verified in incognito on `https://gitlaunch.dev` that a `gl_vid` cookie is set, a real signup lands in `leads`, and that same signup appears on `/dashboard/analytics` (if it doesn't, `GITLAUNCH_SERVICE_ID` is wrong).
- [ ] Campaign rows added to `CAMPAIGNS.md` with tagged URLs before any link goes out.
- [ ] Decide the stopping rule (sample size / duration) **before** launching, since the panel won't tell you when to stop.
