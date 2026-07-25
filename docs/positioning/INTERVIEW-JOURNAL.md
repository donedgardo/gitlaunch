# Interview Journal

Running log of customer-discovery conversations for the [Positioning Canvas](./positioning-canvas.html), run against the [Customer Interview Guide](./customer-interview-guide.html).

**Rules for this file**

- One entry per conversation, newest at the bottom. Never edit a past entry — append a follow-up entry instead.
- Record **verbatim words** where you have them. Paraphrase is marked as paraphrase.
- Distinguish **what he said** from **what we inferred**. The canvas may only be changed by the first.
- Every entry declares its **weight**: is this a happiest user (A), recent adopter (B), evaluated/churned (C), or a practitioner with no buying context (D — informational only)?
- The canvas is not edited until ~8 interviews. Until then, entries produce **hypotheses and better questions**, not positioning changes.

## Running scorecard

| #   | Date       | Bucket                       | Platform team? | Batch or continuous? | Alternative                                | Dominant fear | Category bucket in their head |
| --- | ---------- | ---------------------------- | -------------- | -------------------- | ------------------------------------------ | ------------- | ----------------------------- |
| 001 | 2026-07-24 | D · practitioner, not a lead | unknown        | not asked            | unknown (implied: the git branching model) | none surfaced | branching model / gitflow     |

### Restore signals

Added after [Restore Frame 001](./RESTORE-FRAME-001.md). Filled from guide section 04. The **diagnose vs. act** column is the one that settles bet 10 — record it even when the rest of the row is thin.

| #   | Undo route taken | Choice or constraint? | Restore clock (detect → diagnose → act) | Diagnose vs. act | Cost per minute of degradation |
| --- | ---------------- | --------------------- | --------------------------------------- | ---------------- | ------------------------------ |
| 001 | not asked        | not asked             | not asked                               | not asked        | not asked                      |

**Target:** 8–12 interviews across buckets A/B/C before revising the canvas. **Bucket-D conversations do not count toward that 8.**

---

## 001 · Gitflow veteran, multi-company

- **Date:** 2026-07-24
- **Bucket:** D — practitioner interview. Not a lead, no buying trigger, no evaluation of GitLaunch.
- **Role/context:** Developer. Career spans several companies with, in his words, very different deployment experiences.
- **Notes quality:** Partial. Open-ended portion only; the guide's sections 03–05 (deploy-day stories, value, category/language) were not reached.

### What he said

- Asked to describe his deployment process — positive or negative — he answered with a **lengthy cross-company narrative**: different companies, very different experiences. He did not narrow to one team or one recent deploy.
- **Most of his experience is around gitflow** — and the reason he gave was **"because it's been widely adopted."** Not because it fit the team, the product, or the release cadence. Adoption breadth was the stated rationale.

### What did NOT come up

Recording the silence, because on an open "tell me about your deployment process, good or bad" the absences are data:

- No unprompted pain. No incident story, no dread, no bottleneck complaint.
- No mention of not knowing what's live in an environment (**blindness fear** — not surfaced).
- No mention of one person owning deploys (**bus-factor fear** — not surfaced).
- No mention of rollback, fast or slow (**rollback fear** — not surfaced).
- No tool named. Not CI, not a dashboard, not a spreadsheet.

Caveat: he had no reason to complain to us — he isn't evaluating anything. Absence of pain here is weak evidence, not counter-evidence.

### Signals scorecard

| Dimension                      | Reading                                                                         | Confidence |
| ------------------------------ | ------------------------------------------------------------------------------- | ---------- |
| Has a platform team?           | Unknown — not asked                                                             | —          |
| Trigger to look for a solution | None. No buying journey exists                                                  | n/a        |
| True alternative(s)            | Unknown. **Implied:** the branching model is the release-state system of record | low        |
| Value they'd hate to lose      | Unknown                                                                         | —          |
| Dominant fear                  | **None surfaced** on an open prompt                                             | low        |
| Who deploys now vs. before     | Unknown                                                                         | —          |
| His one-line description       | n/a — has not used GitLaunch                                                    | —          |
| Category bucket in his head    | **Branching model.** Asked about _deployment_, he answered about _git workflow_ | medium     |

### Inferences — hypotheses only, not findings

1. **He mapped "deployment process" onto "branching model."** Asked about deploying, he answered gitflow. If that mapping is common, then in the developer's head the release pipeline is expressed in git — `develop` → `release/*` → `main`, with `hotfix/*` for emergencies — and the artifact that answers "what's going out" is a **branch**, not a dashboard.
2. **Gitflow's incident move is roll _forward_, not roll back.** The canonical gitflow answer to a bad prod deploy is to cut a `hotfix/*` branch. If that's the muscle memory in these shops, one-click rollback is not the relief they've been waiting for — it's an unfamiliar motion.
3. **Convention beat fit.** "Widely adopted" as the _reason_ suggests that in this category, matching a known convention outranks optimizing for the team. Cheap to onboard, easy to hire into, nobody gets blamed for picking it.
4. **Deployment process reads as an org property, not a personal practice.** His answer was organized by employer, not by preference. That reframes the buying unit: you don't sell a developer a better habit, you sell an org a better standard.

### Open questions to chase next time

- Last deploy at his **most recent** team: which branch, who pressed what, how long from merge to live?
- Last time prod broke: **hotfix forward or roll back?** Who was able to do it?
- Right now, how would he find out what's on staging — **where does he look?** (Does the answer name a branch, a CI run, a person, or a page?)
- Who chose gitflow at that team, and what else was on the table?
- Do those teams ship **continuously or in batched releases?** (Segment screener.)
- Was there ever a company on his list where deploys were genuinely calm? What made it calm?

### Method note

The open "tell me about your deployment process" produced a career survey rather than a story. That's the generality trap the guide warns about. Fix for the next call: take the open question, then immediately anchor — _"Let's take just your most recent team. Walk me through the last thing that went to production."_ One org, one deploy, one week.
