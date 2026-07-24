# Warm Outreach Copy — Network & Newsletter

Ready-to-send copy for the first two channels in the alpha push: **direct network DMs** and the **founder newsletter**. Both are warm, so both lead with the canvas **lead fear** — _you can't say what's actually live right now, and only one person can roll it back_ — not a feature list.

These are the two warmest channels; treat them as the place to validate the plumbing and the positioning **before** spending the cold channels (HN, Reddit, dev.to). See [RUNBOOK.md](./RUNBOOK.md) for setup and [CAMPAIGNS.md](./CAMPAIGNS.md) for the register rows these map to.

> **Anchor angle:** Visibility + bus-factor (the lead fear). Keep every edit anchored to a canvas angle — don't invent new claims. The one-line thesis: _for lean teams with no platform team, GitLaunch is deployment control everyone can drive — it shows exactly what's deployed in every environment and lets anyone promote or roll back in one click._

---

## 1. Network DMs — `utm_content=warm-dm`

**Goal, in order:** (1) book a 30-minute discovery call, (2) validate attribution end-to-end with friendly traffic, (3) signups a distant third. Your warmest contacts are your highest-signal interviews (bucket A in the [interview guide](../positioning/customer-interview-guide.html)) — spend them on a conversation, not a click.

**Rules:** send them **one at a time, personally**. Never paste this as a broadcast. Follow the Mom Test — ask about their world, don't pitch. If they ask what you think, say "I'll tell you after — I don't want to bias you."

**Tagged link (only if they ask where to look):**

```
https://gitlaunch.dev/?utm_source=network&utm_medium=referral&utm_campaign=alpha-launch&utm_content=warm-dm
```

### Template A — lead with the fear, ask for a story (preferred)

> Hey {name} — quick one, no pitch. You're shipping software regularly at {company}, right? I'm trying to understand something specific: when a deploy goes sideways, how does your team figure out what's _actually_ live right now, and who's able to roll it back?
>
> I'm building something in exactly that gap and I'd rather learn from how you actually work than talk your ear off about it. Any chance I could steal 30 min this week or next? Genuinely just want the real story.

### Template B — for people who already know the space

> Hey {name} — I'm building GitLaunch: deployment control a whole lean team can drive, so it's not just the one person who knows the pipeline who can say what's live or roll it back. You've lived that problem — I'd love 30 min to have you poke holes in it before I go wider. Up for it?

**When they say yes:** book the call, then run the [customer interview guide](../positioning/customer-interview-guide.html). Score the four bets (segment, alternatives, value, fear) and capture verbatim quotes — those become the next `benefit-led` hero variant and the next campaign's copy.

**Only if they'd rather just try it than talk:** send the tagged link above and let the landing page's waitlist form take it from there.

---

## 2. Newsletter — `utm_content=founder-network`

**Goal:** waitlist signups (the measurable outcome), and establish the **referral baseline** every cold channel will later be judged against. This is a one-to-many warm send, so it drives to the waitlist rather than to individual calls — but every signup is still an invite to a conversation later.

**Tagged link — use this exact URL for every link in the send:**

```
https://gitlaunch.dev/?utm_source=newsletter&utm_medium=referral&utm_campaign=alpha-launch&utm_content=founder-network
```

> **Note:** this reuses the existing `newsletter / referral / founder-network` row in [CAMPAIGNS.md](./CAMPAIGNS.md). Don't fragment it — keep the whole newsletter send on this one tag so the baseline stays clean. The landing page's `waitlist-hero-copy` A/B test runs independently and will randomize which hero each reader sees; that's expected and separate from this UTM.

### Blurb — drop-in section for the newsletter

> **What's actually live in production right now? Quick — who on your team can answer that, and who can roll it back?**
>
> On most lean teams the honest answer is "not sure" and "just one person" — and you only find out on the bad day, at the worst hour, when that one person is asleep.
>
> That's the problem I've been building **GitLaunch** to kill. It's deployment control your whole team can drive on top of your existing GitHub Actions: one board that shows exactly what's deployed in every environment, and one click for anyone to promote or roll back — not just the person who wrote the pipeline. No platform team required.
>
> I'm opening a small alpha and inviting people in waves. If you ship software regularly and you've ever felt that "wait, what's actually live?" dread, I'd love to have you in early.
>
> **→ [Join the alpha waitlist]({{tagged-link}})**
>
> _Reply to this email if you'd rather just tell me how your team handles deploys today — those conversations are shaping what I build next._

### Subject line options

- `What's actually live in prod right now?`
- `The 3 a.m. deploy problem`
- `Who on your team can roll back prod?`

---

## After the links go out

1. **Confirm the pipe works first** — RUNBOOK.md §6 checklist, especially `ANALYTICS_WAREHOUSE=true` in Railway, or you collect nothing.
2. **Read campaign results from the `leads` collection**, grouped by `attribution.campaign` / `attribution.source` — **not** `/dashboard/analytics` (the `waitlist_signup` event carries no `accountId`, so it never shows there). Query is in RUNBOOK.md §5.
3. **Update [CAMPAIGNS.md](./CAMPAIGNS.md)** — flip each row's status and keep the signup count current.
4. **Judge against the bar:** the referral rate these two warm channels produce is the yardstick for the cold channels. Signup-conversion target is > 2% (MARKETING_RESEARCH.md); warm should clear it comfortably.
5. **Interview every signup** against the four bets, and roll the sharpest verbatim quotes into the next hero variant.
