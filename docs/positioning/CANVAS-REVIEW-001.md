# Positioning Review · after Interview 001

**Reviewing:** [Positioning Canvas](./positioning-canvas.html) draft v1
**Evidence:** [Interview Journal](./INTERVIEW-JOURNAL.md) entry 001 — one bucket-D practitioner conversation, no buying context
**Date:** 2026-07-24

## Verdict

**Nothing in the canvas changes. Canvas stays draft v1.**

Say the uncomfortable part first: this is one conversation, with someone who is not a lead, not a user, and not evaluating anything. Positioning is derived from the customers who already love you and would be upset if you vanished — because they are the ones whose context makes your strengths obvious. A practitioner with no buying trigger is, by construction, the weakest evidence in the room. He has no reason to have a problem, so his not having one tells you almost nothing.

The danger with n=1 is not that you'll learn the wrong thing. It's that a vivid conversation feels like a mandate. It isn't. What this call earns is **two new bets on the board and five better questions** — not a single edit to the six components.

## What survived, what wobbled, what is untested

| Canvas component                                           | Status after 001                                                                                                                                                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 · Competitive alternatives                              | **Wobbled — new candidate.** The list is spreadsheet / Slack / the one hero / CI logs / heavyweight CD. Interview 001 suggests a sixth: _the branching model itself_. Not confirmed.                                 |
| 02 · Unique attributes                                     | **Untested.** He evaluated nothing.                                                                                                                                                                                  |
| 03 · Value & proof                                         | **Untested**, with one specific risk to rollback (below).                                                                                                                                                            |
| 04 · Who cares a lot                                       | **Untested**, with a segment-boundary question raised (below).                                                                                                                                                       |
| 05 · Market category                                       | **Weak signal, consistent with the canvas.** Asked about deployment, he reached for a git concept. He did _not_ reach for "CI/CD tool." One data point, but it's the direction we want.                              |
| 06 · Trend ("backlash against DIY platform complexity")    | **Unsupported.** He gave zero backlash energy. His stated driver was conformity — "widely adopted." Not disproved; just carrying no evidence. Component 06 is the least-evidenced part of the canvas and always was. |
| The lead fear (3 a.m. / blindness / bus-factor / rollback) | **Untested.** None surfaced, but the conversation never got to sections 03–05.                                                                                                                                       |

## Two new bets to add to the interview guide

The guide currently tests four bets (segment, alternatives, value, fear). Add these.

### Bet 5 · The competitive alternative may be the branching model

**Claim:** On gitflow teams, the release branch _is_ the record of what's going out. `release/2.15.0` looks like an answer to "what's shipping." A dashboard that tells you what's deployed where competes not with a stale spreadsheet but with a belief that git already answers the question.

**Why it matters:** It changes the enemy. Against a spreadsheet, your pitch is _"stop maintaining that."_ Against a branch graph, the pitch has to be _"a branch tells you what was merged, not what is running"_ — merged is not deployed, and the gap between them is exactly where the 3 a.m. call lives. That's a sharper, more specific wedge, but only if teams actually hold this belief.

**We're wrong if:** Interviewees, asked where they'd look to see what's on staging, name a person, a CI run, or a page — not a branch.

**Question to add:** _"Right now, how would you find out what's running on staging? Walk me to the exact place you'd look."_

### Bet 6 · Roll-forward may beat rollback as the incident reflex

**Claim:** Gitflow's canonical response to a bad production deploy is `hotfix/*` — fix forward. If that reflex is widespread, "one-click rollback" is not a relief they're seeking; it's a motion they don't perform.

**Why it matters most of all:** Hook A1 — _"Know exactly what's deployed where — and let anyone roll it back in one click"_ — is the canvas's designated lead. Half of the lead hook rests on rollback being the thing they wish were easier. If it isn't, hook A3 (_"Your releases on one screen… no platform team required"_) is the safer lead, and rollback becomes a supporting proof point rather than the headline.

Worth noting this cuts both ways: teams fix forward partly _because_ rolling back is unavailable or scary. "We always hotfix" can be evidence of the pain, not evidence against it. The question has to separate _preference_ from _constraint_.

**We're wrong if:** People describe rollback as something they'd do if they could, or tell hotfix stories with visible pain in them.

**Question to add:** _"Last time production broke — did you roll back or fix forward? Was that a choice or the only option available?"_

## One segment question this raises

Gitflow, as designed, is a **batched-release** model: accumulate on `develop`, cut a release branch, stabilize, ship. The canvas beachhead is **frequently-shipping** startups. Those pull in opposite directions.

If gitflow really is as widely adopted as he says, one of two things is true, and they demand opposite responses:

- **The beachhead is correctly narrow.** Gitflow shops batch, feel deployment pain less often per-deploy, and are simply not the target. Fine — that's what a beachhead is for. Hold the line.
- **The beachhead is smaller than we assumed,** and the volume of teams sits in batched-release land.

The Dunford answer, if it turns out to be the second: **do not broaden the segment to chase volume.** Broadening is how you end up back on the CI/CD shelf, judged on features you don't have. Land the narrow beachhead first; a batched-release variant is a second act, not a hedge.

Concretely, this means adding a screener question to section 01 of the guide: _"Do you ship when something's ready, or do you batch into releases?"_ — and then tracking whether the enthusiasts cluster on one side.

## What I'd resist doing

- **Rewriting the trend component around "gitflow inertia."** One person's rationale is not a market trend. Component 06 is currently the weakest, but weak-and-untested beats confidently-wrong.
- **Adding gitflow language to the site.** If we start saying "works with your gitflow," we've let one conversation write copy. Copy comes from repeated verbatim language across interviews.
- **Treating "no pain surfaced" as a threat to the fear hypothesis.** He wasn't asked the questions that surface it. That's a gap in the call, not a finding.
- **Counting this toward the 8.** It's bucket D. The 8–12 target is still 8–12 real users.

## Next actions

1. Add Bets 5 and 6 to the interview guide's four-bets table, with the two questions above.
2. Add the batch-vs-continuous screener to section 01 (Warm-up & context).
3. Add the anchoring fix to the ground rules: after the open question, immediately narrow to one team and one recent deploy, or you get a career survey instead of a story.
4. Keep prioritizing bucket A — the happiest users. That's where positioning actually comes from.
