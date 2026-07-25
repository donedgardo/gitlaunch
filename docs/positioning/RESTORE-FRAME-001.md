# Positioning Review · Restore time as the shared axis

**Reviewing:** the rollback vs. fix-forward divide raised by [Canvas Review 001](./CANVAS-REVIEW-001.md) (Bet 6) and answered one way by [Flags Positioning 001](./FLAGS-POSITIONING-001.md) (Bet 8)
**Related:** [Positioning Canvas](./positioning-canvas.html) draft v1 · [Homepage Hero](./homepage-hero.html) · [Interview Journal](./INTERVIEW-JOURNAL.md)
**Date:** 2026-07-25

## Verdict

**Rollback vs. fix-forward is a divide in _mechanism_, not a divide in _buyers_. Position on the outcome both camps are already judged by: time to restore.**

Bet 6 and Bet 8 are both framed as a fork in the road — if teams fix forward, hook A1 loses its lead; if flag-off wins, hook A4 takes over. That framing makes a coin flip out of something that shouldn't be one. Underneath the mechanism argument, every team that runs software in front of paying users is measured on the same clock: how long between "something is wrong" and "it's no longer wrong."

Roll back, hotfix forward, switch the flag off — those are three routes to one destination. Sell the destination. Let the route be theirs.

Two consequences follow, and they point in opposite directions from what the earlier reviews assumed:

1. **Bet 6 stops being dangerous.** It gets demoted from "does our value prop survive" to "which mechanism do we lead the copy with." That's a copy decision, not an existential one.
2. **Fix-forward teams may have _more_ to gain from us, not less** — for a structural reason spelled out below. The user instinct that "some care more than others" is right, but the sorting variable isn't the branching model.

## The bug this fixes in the current documents

We already say MTTR. We say it backwards.

| Where                               | Current wording                                                               | The problem                                             |
| ----------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------- |
| Canvas, component 03                | "Cuts **lead time** (code-complete → live) and **MTTR** (one-click rollback)" | MTTR is presented as a _consequence of rollback_        |
| Homepage hero, metrics band         | "↓ MTTR — **One-click rollback** turns 'how long were we down?' into seconds" | Same: the metric is justified by the mechanism          |
| Flags Positioning 001, component 03 | "Sharpen MTTR: undo now has two speeds"                                       | Better — but still a list of mechanisms, not an outcome |

In every case the mechanism is the parent and the outcome is the child. That's the wrong way round, and it's precisely why Bet 6 reads as threatening: if rollback turns out not to be the reflex, the MTTR claim falls over with the mechanism that was holding it up.

Invert the hierarchy and the exposure disappears:

> **Promise:** when prod is wrong, you get back to right in minutes, not hours.
> **Routes:** roll the build back · switch the feature off · ship the fix fast — whichever your team actually does.

Now Bet 6's answer can't hurt us. Whatever the interviews say, we're selling the same thing; we only learn which route to put in the first sentence.

## Where we actually win on the clock

Restore time is not one number. It decomposes, and the decomposition is where our differentiated attribute lives.

| Phase        | The question being answered                   | What shortens it                                        | Who else shortens it             |
| ------------ | --------------------------------------------- | ------------------------------------------------------- | -------------------------------- |
| **Detect**   | "Is something wrong?"                         | Monitoring, alerting, customer complaints               | Datadog, Sentry, PagerDuty       |
| **Diagnose** | "What changed? Is it the deploy or the flag?" | **Deploy state × flag state, one screen, one timeline** | **Nobody on either shelf**       |
| **Decide**   | "What's the safest undo from here?"           | Knowing exactly what's running where                    | **Nobody on either shelf**       |
| **Act**      | "Do the undo."                                | One-click rollback / flag-off / fast pipeline           | Every CD tool, every flag vendor |

Rollback buttons compete on **act**. That's the crowded column — it's also the column where a fix-forward team never buys, because they've already decided not to press that button.

Our uncopyable claim from [Flags Positioning 001](./FLAGS-POSITIONING-001.md) — _builds and flags scoped by the identical `account + service + environment` key, one timeline, one audit trail_ — buys **diagnose** and **decide**. And those two columns are **mechanism-agnostic**. The team that hotfixes forward still has to know what changed before they can write the fix. They pay the diagnose tax at exactly the same rate as the team that rolls back.

That's the whole argument in one line: **we shorten the half of the clock that both camps share.**

## Why fix-forward teams may need this more

Here is where "some more than others" inverts against intuition.

A fix-forward team's **act** phase is structurally long and structurally incompressible. Write the fix, get it reviewed, wait for CI, deploy. Minutes at best, usually longer, and you cannot shorten it much without turning it into a rollback — which is the thing they've declined to do.

So for a fix-forward team, essentially the _only_ compressible part of the restore clock is diagnose + decide. They have more of their total time sitting in the columns we're good at, and no way to buy it back from a CD vendor selling a rollback button.

The rollback team, by contrast, already has a short act phase. Their marginal gain from us is smaller on that column — they buy us for visibility and bus-factor instead.

This does not mean fix-forward teams _feel_ it more. Normalized pain is invisible pain: if two hours to restore has always been two hours, nobody's shopping. Which is why this is a bet and not a finding — see Bet 10.

## Who cares more — the sorting variable

Not the branching model. **Cost per minute of degradation.**

A team ranks high on this axis when some combination holds: revenue flows through the thing that breaks, customers notice within minutes, there's a contractual response time, or someone carries a pager. A team ranks low when the blast radius is an internal tool and the fix can wait until morning.

This cuts _across_ the batch-vs-continuous screener from Review 001, and across the branching model entirely. A batched gitflow shop running a paying product has a high cost per minute; a continuously-deploying team shipping an internal admin panel has a low one. Track both variables in the scorecard and see which one the enthusiasts actually cluster on.

If cost-per-minute turns out to be the real sorter, it's a better segment definition than "no platform team" is — it names a stake rather than an absence. Not proposing that change; noting where the evidence could take us.

## The trap to avoid: don't make the metric the frame

Same discipline [Flags Positioning 001](./FLAGS-POSITIONING-001.md) applied to the word "feature flags" applies here to the word "MTTR," and it needs saying because the temptation is stronger.

**DORA-metrics dashboards are their own shelf.** Several credible products exist whose entire pitch is measuring the four keys and showing you the trend line. If we lead with "improve your MTTR," we get compared against them — judged on metric coverage, integration breadth, and historical charting, none of which we do or should do. We'd be reproducing the CI/CD mistake on a smaller shelf.

The distinction that keeps us safe:

- **Frame** (hero, deck, category line, first sentence of a call): the concrete moment. Something's wrong in prod at 3 a.m., one screen tells you whether it's the deploy or the flag, and anyone on the team can undo it. Visceral, specific, no acronym.
- **Prove** (metrics band below the fold, docs, the ROI slide, the board conversation the buyer has _after_ us): time to restore, framed as DORA. This is where the existing hero band belongs, and it's fine where it is.
- **Instrument** (this document, the interview guide, the scorecard): restore time is our internal axis for comparing prospects and deciding which mechanism to lead with.

MTTR is how we think, not how we open.

_Terminology note for anything customer-facing: DORA's own reports have moved away from "MTTR" toward "failed deployment recovery time." Prefer plain language — "how long until it's working again" — over either acronym._

## What changes in the canvas (proposed, not applied)

Consistent with the standing rule — the canvas is not edited until ~8 bucket A/B/C interviews, and we still have zero — these are proposed edits held for that revision. The exception argument would be that a frame is cheap to change and this one only reorders existing claims, but it isn't worth breaking the discipline for.

| Component / surface           | Proposed change                                                                                                                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canvas 03 · Value & proof     | Restructure so restore time is the claim and the mechanisms are sub-bullets: _"Cuts time to restore — roll the build back, switch the feature off, or ship a fix fast, from one screen that tells you which you need."_ |
| Canvas 03 · Proof line        | Keep the two-DORA-metrics proof. It's the right proof; it just shouldn't be inherited through the word "rollback."                                                                                                      |
| Canvas 02 · Unique attributes | State the diagnose/decide win explicitly: _"the only screen that answers 'is it the deploy or the flag' — before you pick an undo."_ Reinforces the Flags 001 addition rather than adding a new one.                    |
| Hero metrics band             | Change the MTTR sub-copy from "One-click rollback turns…" to something mechanism-neutral: _"Know what changed, pick the fastest undo, and be back — whether that's a rollback, a flag, or a fix."_                      |
| Hero frame / headline         | **No change.** It's already concrete and stays that way.                                                                                                                                                                |
| Canvas 04 · Who cares a lot   | Add cost-per-minute-of-degradation as a **second** qualifier alongside "no platform team." Track it before promoting it.                                                                                                |
| Lead hook                     | **No change yet.** A1 vs. A3 vs. A4 is now correctly a question about which route to name first, and interviews decide it.                                                                                              |

## Bets

### Bet 6 · Revised — demoted from existential to editorial

**Was:** "Roll-forward may beat rollback as the incident reflex" — treated as a threat to the lead hook and half the value prop.

**Now:** the mechanism split determines **which route we name first in copy**, nothing more. Both routes serve the same promise, and diagnose/decide is sold to both camps identically.

**Still worth asking**, because it decides the copy, and because Review 001's caveat still stands: teams may fix forward _because_ rollback is unavailable or frightening, which makes "we always hotfix" evidence of pain rather than evidence against it. The question must still separate preference from constraint.

### Bet 9 · Restore time is felt as a cost, not tracked as a metric

**Claim:** our segment does not measure MTTR. Nobody has a dashboard for it. But they can tell you, with feeling, how long the last bad one took and what it cost — in refunds, in a customer call, in a weekend.

**Why it matters:** it decides how we ask. If they don't have the number, asking "what's your MTTR?" produces a fabricated one and burns credibility. We reconstruct the clock from the story instead. It also confirms whether the metrics band earns its place on the page at all for this buyer, or whether it's really aimed at the person they report to.

**We're wrong if:** interviewees quote a tracked figure, name an SLA they measure against, or point at a dashboard. If they do, they're further up-market than our stated segment — which is itself a finding.

**Questions to add** (section 03, Deploy-day stories):

- _"Walk me through the clock on that one. When did you first know something was wrong? When did you know **why**? When was it actually better again?"_
- _"What did that gap cost you — money, a customer, a weekend?"_

### Bet 10 · Diagnose dominates act

**Claim:** most of the restore clock is spent figuring out what changed, not performing the undo. The undo itself is usually fast once you know what to undo.

**Why it matters most of all:** this is the load-bearing bet under the whole document. Our differentiated attribute buys diagnose and decide. If those turn out to be seconds and the pain is genuinely in the act phase, then the rollback button _is_ the product, Bet 6 goes back to being dangerous, and the deploy×flag join is a nice-to-have rather than the moat.

**We're wrong if:** people describe knowing instantly what broke, and the time going into building or shipping the fix.

**Question to add** (section 03): _"Between 'something's wrong' and 'we know what to undo' — how much of that outage was which?"_

## What I'd resist

- **Rewriting the hero around MTTR or DORA.** Metric-forward copy puts us on the metrics-dashboard shelf and hands the buyer a comparison we lose. Concrete moment above the fold, metric as proof below it.
- **Asking interviewees for their MTTR number.** We'd get a fabrication. Reconstruct the clock from a specific incident instead — the questions above do that.
- **Treating this as evidence about the market.** It's a reframe of claims we already hold, prompted by an internal reading of PR #31. Zero new interviews. Still draft v1.
- **Retiring Bet 6 or Bet 8.** Both still get asked. Demoted is not answered, and Bet 8's specific question — whether flag-off _feels_ safer or scarier than a rollback — is genuinely unknown and independently interesting.
- **Claiming the diagnose win before the product delivers it.** Today flag state lives in `settings/`, not on the release board. Until Next Action 1 of Flags 001 ships, "one screen tells you whether it's the deploy or the flag" is a roadmap item, not a demo. Do not put it in a deck ahead of the product.

## Next actions

1. **Add Bets 9 and 10 and the three clock questions to the interview guide**, section 03. Note this stacks on unshipped next-actions from both prior reviews — Bets 5–8 and their questions are still only in review docs, not in `customer-interview-guide.html`. Do one pass that lands all six bets and all their questions at once.
2. **Add two columns to the journal scorecard:** restore clock (detect → diagnose → act, reconstructed) and cost per minute of degradation. Cheap to collect, and Bet 10 can't be settled without the first one.
3. **Hold the canvas and hero edits** in the table above for the post-8-interview revision. The only one worth doing sooner is the hero MTTR sub-copy, since it currently makes a claim that a single interview could falsify.
4. **Ship flag state onto the release board** — already Next Action 1 of Flags 001, now with a second justification: it's the product half of the diagnose claim, and the claim isn't demoable without it.

---

_A frame, not a finding. It reorders claims we already hold so that a pending interview answer can't knock a leg out; it does not add evidence. Bet 10 is the one to take into the next eight calls — everything here rests on it._
