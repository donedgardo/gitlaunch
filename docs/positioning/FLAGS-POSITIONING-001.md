# Positioning Review · Where feature flags fit

**Reviewing:** the `featureflags` product surface against the [Positioning Canvas](./positioning-canvas.html) draft v1
**Related:** [Canvas Review 001](./CANVAS-REVIEW-001.md) · [Interview Journal](./INTERVIEW-JOURNAL.md)
**Date:** 2026-07-25

## Verdict

**Flags do not get their own shelf. They get their own _leg_ of the shelf we already chose.**

Concretely:

- The market category **does not change**. It stays "release & deployment control for teams without a platform team."
- Component **02 (unique attributes)** and **03 (value & proof)** change: flags add a genuinely differentiated attribute that no competitor on either shelf currently has.
- Component **01 (competitive alternatives)** gains a real entry — and it is _not_ LaunchDarkly. It is "we hardcode it and redeploy."
- We use the words "feature flags" **to be found**, never **to be framed**. Those are different jobs and conflating them is how we end up on the wrong shelf.
- No separate brand, no separate SKU, no separate pricing meter. Not yet, and probably not for a year.

The instinct in the prompt is right — flags reach past operations into product engineering. But "our feature reaches a second audience" is an argument for a **second act**, not a second position. A pre-revenue alpha with one logged interview cannot afford two shelves.

## What we actually built (the evidence)

Worth saying plainly, because the scale of it is the whole problem. Across nine branches the flag engine now has:

| Capability                     | Where                                                       | Which shelf it serves    |
| ------------------------------ | ----------------------------------------------------------- | ------------------------ |
| Deterministic % rollout        | `flagEvaluator.ts` (sha256 bucketing)                       | Delivery control         |
| Kill switch / enable per env   | `flagService.ts`, per-env `FlagEnvironmentConfig`           | Delivery control         |
| Targeting rules / allow-lists  | `targetingRules` on env config, 5 operators                 | Delivery control         |
| Immutable config versions      | `configBundle.ts`, `flag_config_versions`                   | Delivery control / audit |
| Read-through cache, Redis-ready | `flagCache.ts`, `RedisFlagCache`                            | Delivery control         |
| Weighted A/B variants          | `variants[]` + weights                                      | **Product engineering**  |
| Exposure + conversion capture  | `flag_exposure` / `flag_conversion` → analytics warehouse   | **Product engineering**  |
| Experiment results + stats     | `ExperimentResultsService`, `significance.ts` (z-test, MDE) | **Product engineering**  |
| Publishable browser keys, CORS | `pk_`/`sk_` split, `flags:evaluate`, origin allow-list      | **Product engineering**  |

And it appears in **zero** market-facing surfaces. Not in the canvas. Not on `index.hbs`. Not in `MARKETING_RESEARCH.md`. Not in the pricing table. The only public trace is a nav icon at `/services/:id/flags`.

That gap _is_ the incoherence. We have been building the right half of a product we are not selling, next to the left half of a product we are selling on one interview's worth of evidence.

### One product-surface tell

The flags UI lives in `src/templates/settings/flags.hbs`, behind `registerFlagsSettingsRoutes`. We built flags as **settings**. But the canvas's central promise is _"one screen answers: where is build X, what's on each environment, what's ready to promote."_ If a flag changes what's live in an environment — and it does — then the flag state belongs on the release board, not in a settings tab. The file path is telling us the positioning hasn't reached the product yet.

## The three candidate positions

### A · Standalone feature-flag product ("GitLaunch Flags")

**Reject.** This is the exact mistake the canvas already refused once.

We refused the CI/CD shelf because it is commoditized and crowded, and because we'd be judged on criteria we don't compete on — YAML, plugins, build minutes. The feature-management shelf is the same trap with worse economics:

- **The judging criteria we'd lose on:** SDK breadth (a dozen-plus languages, server + client + mobile + edge), streaming config updates, sub-50ms edge evaluation from a global POP network, a mature stats engine (sequential testing, CUPED, guardrail metrics), SOC 2 / audit / approval workflows, and a JS SDK that isn't a hand-rolled `curl` snippet. We have an HTTP endpoint, an origin allow-list we ourselves documented as "a guard rail, not a secret," and no packaged SDK.
- **The price floor is zero.** Flags are a loss-leader for the analytics platforms and there are credible open-source engines. "High demand" in a category where several respected players give the core away is not an opening — it's a signal that the value has migrated somewhere else. _(Vendor specifics deserve a fresh check before they go in a deck; the structural point holds regardless of who's who this quarter.)_
- **The buyer is wrong for us.** Serious flag buyers are growth/experimentation teams at companies large enough to have one. Our whole thesis is teams that _don't have the specialist_. Chasing the flags shelf walks us straight into rooms where our stated segment isn't sitting.

If we position on this shelf, our honest score is "cheaper, thinner LaunchDarkly." That's a losing sentence.

### B · Flags as a feature of the existing position

**Mostly right, and the base of the recommendation.** Progressive rollout, kill switch, and allow-lists are not experimentation — they are **delivery control at a finer grain than the deploy**. They belong to the position we already hold, and they extend it in the direction it was already pointing.

Note what our own dogfooding chose, unprompted: `self-serve-signups` is a kill switch with gradual opening and an allow-list — pure delivery control. `waitlist-hero-copy` is a copy A/B — product engineering. Two internal uses, one on each side. Even our own usage tells us the delivery-control half is the native one.

Its limit: it leaves the experimentation work (variants, conversions, significance) as an unmonetized orphan.

### C · A second product for a second buyer, under a company-level umbrella

**Premature, but this is where the second act lives.** A separate position is legitimate when there are two buyers, two budgets, and two viable products. We have neither budget validated — and eight interviews of the _first_ segment still outstanding. Splitting positioning now means neither story gets the repetition it needs to stick.

Revisit when: paying delivery-control customers start using the variant/results surface on their own, without being told to.

## The actual differentiated attribute — and it isn't the flag engine

Here is the thing worth building the story on.

**Every flag vendor knows what's _on_. Every CD tool knows what's _deployed_. Neither knows both.**

When something breaks at 3 a.m., the lean team's first question is not "what's my flag state" or "what's my build" — it's **"is this the deploy or the flag?"** Today they answer that by hand, eyeballing two tools with two different notions of "environment," and they get it wrong under pressure.

GitLaunch is the only one of the two that can answer it, because of an architectural accident that turns out to be the moat: **builds and flags are scoped by the identical key** — `account + service + environment`. Same tenancy model, same environment vocabulary, one timeline, one audit trail, one screen.

That yields a claim nobody on either shelf can copy cheaply:

> One screen shows what build is running in each environment **and** what's switched on inside it — and lets anyone undo either one.

Everything else in the flag engine is table stakes we needed in order to earn that sentence. The immutable config versions matter here too: "prod is running build #4291 with flag config v37" is a single, quotable release state. That's an artifact no flags vendor produces and no CD vendor produces.

## This resolves the open question from Canvas Review 001

Review 001 flagged **Bet 6** as the most dangerous unknown: gitflow shops fix _forward_ (`hotfix/*`), so "one-click rollback" — half of lead hook A1 — may be a motion they don't perform.

Flags dissolve that tension rather than losing it. **Turning a flag off is not a rollback.** It is the fastest possible fix-forward: it removes the bad behaviour without reverting anyone else's merged work, and it needs no deploy at all. For a team whose reflex is "never roll back the build," flag-off is the undo they'll actually reach for.

So flags don't just survive Bet 6 — they're the hedge against it. If interviews confirm roll-forward dominates, the lead hook doesn't get weaker; it gets **more precise**:

> _"Something's wrong in prod. Turn it off in one click — no hotfix branch, no deploy, no war room."_

That is a stronger sentence than the current A1, and it's only sayable because we own both halves.

## What changes in the canvas (and what doesn't)

| Component                        | Change                                                                                                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 · Competitive alternatives    | **Add one:** _"hardcode it, redeploy to change it, redeploy again to undo it."_ That — not LaunchDarkly — is what our segment actually does today. Note deliberately that we do **not** list flag vendors here; that's an inventory we don't compete in. |
| 02 · Unique attributes           | **Add:** _deploy state and flag state in one model, one screen, one audit trail._ This is the only genuinely uncopyable item on the list. Rollout/kill-switch are supporting bullets under it, not headline attributes.                             |
| 03 · Value & proof               | **Sharpen MTTR:** undo now has two speeds — roll back the build, or switch the feature off without deploying. The second is seconds and needs no CI run. Strengthens the existing DORA proof rather than adding a new claim.                        |
| 04 · Who cares a lot             | **No change.** Same segment, extended rationale: a team with no platform team also has no growth team. The connective tissue of the whole company is _"no specialist required."_                                                                    |
| 05 · Market category             | **No change.** Still not a CI/CD tool. Also **not a feature-management platform.**                                                                                                                                                                 |
| 06 · Trend                       | **Strengthened, still under-evidenced.** "You shouldn't need a platform team to deploy safely" now extends to "you shouldn't need a growth team to ship safely and learn." Same anti-specialist thesis. Still our weakest component; don't lean on it. |
| Lead hook                        | **Candidate A4** (above). Do not promote it over A1/A3 until interviews say roll-forward dominates.                                                                                                                                                |

## Words to be found by vs. words to be framed by

These are separate jobs and the distinction saves us here.

- **Frame (site hero, deck, category line, first sentence of a sales call):** never "feature flags," never "feature management," never "experimentation platform." Those words hand the buyer a comparison chart we lose on.
- **Find (docs, feature list, SEO pages, changelog, integration listings, the nav item itself):** absolutely say "feature flags." It's the search term, it's what the API is called, and pretending otherwise makes us unfindable and slightly weird.

Rule of thumb: if a buyer arrives searching "feature flags," they should find us and see a page that reframes the problem within ten seconds. If a buyer arrives cold, they should never learn the phrase "feature management" from us.

## Pricing implication

Do **not** meter flags by MAU or by evaluation count. That is the incumbent's pricing shape, and adopting it invites a line-by-line comparison against a vendor with a global edge network. It also punishes exactly the usage we want (dogfooding, cheap kill switches).

Put flags in the existing tier ladder as a capability — Pro and up — sold as _"safer releases,"_ not as _"N flags included."_ The pricing table in `MARKETING_RESEARCH.md` predates flags entirely and needs a row either way.

## Two bets to add to the interview guide

Following the Review 001 convention — these are questions, not conclusions.

### Bet 7 · The flags buyer and the deployment-control buyer are the same person

**Claim:** on a lean team with no platform team, the person who wants "see what's deployed and roll it back" is the same person who wants "ship it to 10% first." Not two buyers — one person wearing both hats because there's nobody else.

**Why it matters:** it's the entire justification for one shelf. If they're different people with different budgets, option C gets real and the roadmap splits.

**We're wrong if:** interviewees name a separate person or team for rollouts/experiments, or say flags are already owned by someone else's tool that they don't control.

**Question to add:** _"When you want to ship something risky to a few users first — who sets that up, and where does it live today?"_

### Bet 8 · "Turn it off" beats "roll it back" as the incident reflex

**Claim:** flag-off is the undo lean teams will actually reach for, because it needs no deploy and reverts nobody else's work.

**Why it matters:** it's the direct answer to Bet 6, and it decides whether hook A4 outranks A1.

**We're wrong if:** teams describe reverting the whole deploy as the natural move, or say a flag-off feels riskier because they don't know what state it leaves the system in.

**Question to add:** _"Last time you shipped something and it was wrong — did you undo the whole release, or was there a way to switch just that thing off? Which would you have preferred?"_

## What I'd resist

- **Launching a `/feature-flags` landing page.** It would be found by people shopping the shelf we refuse, and judged against SDKs we don't have. The flags story goes _on the existing page_, as the second half of the release-control promise.
- **Building a JS SDK to close the gap with flag vendors.** That's competing on their criteria. The gap worth closing is on _our_ criteria: put flag state on the release board next to the build.
- **Treating "flags are in high demand" as market evidence.** Demand with a zero price floor is not an opening. Our opening is the join, and the join has no demand data yet — Bets 7 and 8 exist to get some.
- **Renaming the company or the product around releases/experiments.** One conversation didn't earn a canvas edit; one strong architectural insight doesn't earn a rebrand.
- **Letting flags accumulate more engineering before the first paying delivery-control customer.** Nine branches of flag work against one logged interview is already the wrong ratio, and it's the most expensive thing in this document.

## Next actions

1. **Put flag state on the release board.** The single highest-leverage product change implied by this review: each environment card shows its running build _and_ its active flags/config version. This is the "one screen" promise, finished. It also moves flags out of `settings/` where they currently contradict the positioning.
2. **Add the "hardcode and redeploy" alternative** to canvas component 01, and the deploy×flag join to component 02.
3. **Add Bets 7 and 8** to the interview guide's bets table with the two questions above.
4. **Keep the site hero as-is** until interviews land. Add flags to the feature list and docs (find, don't frame).
5. **Add a flags row to the pricing table** in `MARKETING_RESEARCH.md` — capability in Pro+, no usage meter.
6. **Do not start any new flag capability** until the interview count is off 1. The engine is ahead of the evidence; the fix is evidence, not more engine.

---

_This is a review, not a decision. Like the canvas, it is a set of bets. Nothing here is validated by a customer yet — components 02 and 03 are the ones to take into the next eight calls._
