# Building the Warm Outreach List

How to find **who to DM** when the goal is booking interviews, not signups.

This is the missing front half of the funnel: [OUTREACH-COPY.md](./OUTREACH-COPY.md) tells you what to send, the [interview guide](../positioning/customer-interview-guide.html) tells you what to ask on the call — but both assume you already know who to contact. At n=1 signup, you don't. This doc builds that list.

> **Why warm only.** Warm DM is the only channel that has ever produced a human for GitLaunch. Every cold row in [CAMPAIGNS.md](./CAMPAIGNS.md) is still `Planned` with 0 signups. Cold channels come after there's a validated message to put in them.

---

## The math — size the list before you build it

Work backwards from the interview target so you know when to stop sourcing:

| Step                                               | Rate | Count     |
| -------------------------------------------------- | ---- | --------- |
| Interviews needed                                  | —    | **8**     |
| Asks sent (warm, individual, ~25–30% accept)       | ~27% | **~30**   |
| Names that survive qualification (~50% in-segment) | ~50% | **~60**   |
| Raw names to enumerate                             | —    | **60–80** |

**So: the sourcing job is to write down 60–80 names, not 8.** Most of the list gets disqualified or ignores you, and that's the expected outcome — not a failure. Do the enumeration in one sitting; do the sending over two weeks.

---

## Step 1 — Enumerate by **company**, not by person

Interview 001 found that _deployment process reads as an org property, not a personal practice_ — his answer was organized by employer, not by preference. Use that when building the list too.

Trying to recall "who might want this?" produces 5 names and stalls. Instead list the **companies your network touches**, then find your person inside each one:

1. Write down every company where you know at least one person who writes or ships software.
2. For each, write who you know there and what they do.
3. Only then decide what to ask them.

Company-first recall is far more complete than person-first recall, and it surfaces the shops where you know a dev but not the decision-maker — which is exactly where the intro ask belongs.

## Step 2 — Where to pull the raw names

Go source by source. Don't work from memory alone; open the actual lists.

| Source                   | How to extract                                                                   | Notes                                                                           |
| ------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **WhatsApp**             | Scroll the chat list, not contacts — recent conversations are the warmest        | The one real signup came from here. Start here.                                 |
| **Newsletter list**      | Export subscribers; flag anyone who **clicked** the last send                    | Clickers self-selected on the deploy topic — highest intent on the whole list   |
| **LinkedIn connections** | Connections → filter by Industry = software, then scan titles                    | Best source for finding the decision-maker (CTO / VP Eng / Head of Eng)         |
| **Past employers**       | For each company you've worked at, list ex-coworkers and where they went **now** | Where they went now is the useful part — one ex-coworker becomes 3 companies    |
| **GitHub**               | Your following/followers; org members of repos you've contributed to             | Public repos also let you verify Actions/Jenkins before you write               |
| **Phone contacts**       | Sort A–Z once, tag anyone technical                                              | Tedious, catches people the other lists miss                                    |
| **Local PR tech scene**  | Meetup/Discord/WhatsApp groups, local startup community                          | Warm-adjacent and geographically dense — easy to offer coffee instead of a Zoom |
| **X / Twitter mutuals**  | Mutual follows only — a one-way follow is cold                                   | Small pool, but mutuals reply                                                   |
| **Second-degree**        | Every accepted call ends with "who else should I talk to?"                       | This is how the list refills after the first 30                                 |

## Step 3 — Qualify against the canvas

The canvas beachhead is **frequently-shipping startups on GitHub Actions or Jenkins, with no platform team.** Most of that isn't visible from the outside, so use observable proxies:

| Canvas criterion                  | Observable proxy                                                                                                                              | Verdict                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Ships software regularly          | Product company, agency, or product shop — has releases, not just a website                                                                   | Required                   |
| Lean team                         | Roughly **5–50 engineers** — Series A–B, small scaleup, or agency                                                                             | Required                   |
| **No platform team**              | LinkedIn → company → People → search `platform`, `SRE`, `DevOps`, `infrastructure`, `release`. **Zero hits = in segment.** Several hits = out | The sharpest single filter |
| On Actions or Jenkins             | Public repos show `.github/workflows/`; otherwise ask in the screener                                                                         | Nice to have               |
| Deploy bottlenecked on 1–2 people | Not observable — this is what the interview is for                                                                                            | Don't pre-judge            |

**The platform-team check is the one that matters most.** A company with two SREs isn't a weaker lead, it's a _different_ shelf — they're the buyer enterprise CD tools are built for, and the canvas explicitly refuses that fight. Talking to them teaches you about a segment you're not selling to.

Two traps worth naming:

- **Don't filter on "would they buy this?"** You're recruiting for a problem interview, not a demo. Someone who'd never buy can still tell you the truth about how their team deploys.
- **Don't disqualify people who have no pain.** Interview 001 surfaced no pain at all and was still useful — the silences were data. Disqualify on _segment_, never on enthusiasm.

## Step 4 — Tier by the **ask**, not by how much you like them

Your network is the right audience for **routing**, not necessarily for buying. Sort every qualified name into one of three asks:

### Tier 1 — Direct interview ask

They own or heavily influence how their team deploys: CTO, VP/Head of Eng, eng lead, tech-lead, technical founder at a 5–50 person shop.

→ Send **Template A** from [OUTREACH-COPY.md](./OUTREACH-COPY.md) — lead with the fear, ask for a story.

### Tier 2 — Routing ask (this is most of the list)

An IC dev at an in-segment company. They can't decide anything, but they sit inside the org you need and they know who owns deploys.

→ Two asks in one thread. First their own story (they still have one — they deploy), then the intro:

> You mentioned this is more your lead's call than yours — would you introduce me? I'm not selling them anything, I want 20 minutes on how the team deploys.

A friend already gave you the template unprompted: _"show this to my boss, what I'm interested in is how to write the pipelines."_ That's a Tier 2 offering you a Tier 1.

### Tier 3 — Referral only

Out of segment: big co with a platform team, non-technical, solo dev with no team, no deploys.

→ Don't burn an ask. One line: "who's the most deploy-frustrated person you know?"

## Step 5 — Screen in two messages, don't burn the interview

Sometimes you can't tell from outside whether a company is in segment. Screen inside the DM instead of guessing — these are cheap to answer and don't reveal what you're building:

1. "Are you all shipping pretty regularly these days, or in bigger batched releases?"
2. "Is there someone whose job is the deploy pipeline, or does it just land on whoever?" ← **the platform-team question**
3. "Actions, Jenkins, something else?"

Answer to #2 is the fork: _"it lands on whoever"_ or a single name → in segment, ask for the call. _"Yeah we have a platform team"_ → thank them, ask for a referral, move on.

Keep it a conversation. Three questions fired in one block reads like a survey.

---

## Tracking

Keep the list in one place — a spreadsheet is fine. Suggested columns:

| Column         | Values                                                                     |
| -------------- | -------------------------------------------------------------------------- |
| Name           |                                                                            |
| Company        |                                                                            |
| Their role     |                                                                            |
| Source         | whatsapp · newsletter · linkedin · ex-coworker · github · local · referral |
| Segment fit    | in · out · unknown                                                         |
| Platform team? | none · has one · unknown                                                   |
| Tier           | 1 (direct) · 2 (routing) · 3 (referral)                                    |
| Status         | not-sent · sent · replied · booked · **interviewed** · declined · no-reply |
| Date sent      |                                                                            |
| Referred by    | who introduced you — track this, it's your best channel                    |
| Notes          |                                                                            |

**Cadence rules**

- Send **one at a time, personally.** Never broadcast. A DM that reads like a template gets a template response.
- 5–10 asks per day, not 30 in one hour — you need capacity to actually reply.
- **One** follow-up after ~5 days, then stop. Mark `no-reply` and move on; no-reply is not a no forever, it's a no this month.
- Log every interview in [INTERVIEW-JOURNAL.md](../positioning/INTERVIEW-JOURNAL.md) the same day, while you still have the verbatim words.
- Every accepted call ends with **"who else should I talk to?"** That question is what turns 30 asks into 60.

## Related

- [OUTREACH-COPY.md](./OUTREACH-COPY.md) — what to send once you know who
- [Customer interview guide](../positioning/customer-interview-guide.html) — what to ask on the call
- [INTERVIEW-JOURNAL.md](../positioning/INTERVIEW-JOURNAL.md) — where every conversation gets logged
- [Positioning canvas](../positioning/positioning-canvas.html) — the segment definition these filters come from
- [CAMPAIGNS.md](./CAMPAIGNS.md) — the `network / referral / warm-dm` row this feeds
