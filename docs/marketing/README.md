# GitLaunch Alpha Promotion — Marketing Workspace

This is the working space for GitLaunch's **alpha-promotion** marketing — the campaigns, copy, and links we push out to attract early users and grow the alpha waitlist.

Everything here leans directly on two source documents. Read them first; don't reinvent messaging:

- **[Positioning canvas](../positioning/README.md)** — the source of truth for messaging. The segment, the fear, the hook.
- **[Marketing research](../MARKETING_RESEARCH.md)** — competitive landscape, pricing, and landing-page strategy.

The one-line thesis we're promoting (from the canvas): for **lean teams with no platform team**, GitLaunch is **deployment control everyone can drive** — not another CI/CD tool. It shows exactly what's deployed in every environment and lets anyone promote or roll back in one click.

## Goal of the alpha push

Three things, in order:

1. **Get early engagement** — put the positioning in front of real lean-team developers and see what lands.
2. **Feel out the market** — learn which angle and which channel resonates before we commit to a full launch.
3. **Capture qualified emails** — real people who want in, not bots — into an **alpha waitlist** we can invite in waves.

Everything below exists to serve those three goals and to tell us which campaigns are working.

## How we capture interest

The landing page carries a **waitlist email-capture** form. When someone submits, the browser POSTs to `/waitlist`.

The endpoint is **bot-protected** with three layers, all of which must pass:

- **Honeypot field** — a hidden input real users never see or fill; if it has a value, the submission is a bot.
- **Submit-timing check** — forms completed suspiciously fast (faster than a human could type) are rejected.
- **Email validation** — the address must be structurally valid before it's accepted.

Every legitimate signup is **attributed to a campaign** via the UTM parameters carried in on the landing-page URL (see the convention below). On success, the lead is persisted and a `waitlist_signup` event is streamed into the analytics framework with the attribution attached. Blocked bots don't pollute the waitlist — they emit a separate `waitlist_bot_blocked` event so we can watch spam volume without counting it as interest.

> This description tracks the engineering implementation being built alongside it. If the endpoint, the bot checks, or the event names change in code, update this section to match.

| Outcome            | What happens                    | Analytics event        |
| ------------------ | ------------------------------- | ---------------------- |
| Valid human signup | Lead saved with UTM attribution | `waitlist_signup`      |
| Bot / failed check | Rejected, no lead saved         | `waitlist_bot_blocked` |

## Campaign tracking convention

**Every outbound link must be tagged.** Untagged links are invisible in the data — we can't tell you which campaign a signup came from. Use this UTM scheme, no exceptions:

| Field          | Meaning                                   | Values to use                                                   |
| -------------- | ----------------------------------------- | --------------------------------------------------------------- |
| `utm_source`   | Where the link lives                      | `twitter`, `hn`, `reddit`, `devto`, `newsletter`, `producthunt` |
| `utm_medium`   | Type of placement                         | `social`, `post`, `email`, `referral`, `community`              |
| `utm_campaign` | The campaign slug                         | e.g. `alpha-launch`                                             |
| `utm_content`  | Variant, for A/B testing copy or creative | e.g. `fear-angle`, `rollback-angle`                             |
| `utm_term`     | Optional keyword                          | e.g. `rollback`, `no-platform-team`                             |

**Example tagged URLs** (base: `https://gitlaunch.dev/?...`):

```
https://gitlaunch.dev/?utm_source=hn&utm_medium=post&utm_campaign=alpha-launch&utm_content=fear-angle
https://gitlaunch.dev/?utm_source=twitter&utm_medium=social&utm_campaign=alpha-launch&utm_content=rollback-angle&utm_term=one-click-rollback
https://gitlaunch.dev/?utm_source=devto&utm_medium=post&utm_campaign=alpha-launch&utm_content=anyone-can-ship
```

These fields map **1:1** to the attribution stored on each lead and to the property names on the `waitlist_signup` analytics event. Tag the link once, and the source / medium / campaign / content / term travel all the way from the click to the lead record to the analytics dashboard.

## Reading the data

Two places to look, one for people and one for trends:

- **Leads** land in the `leads` MongoDB collection, each row carrying its full UTM attribution. This is the invite list and the raw record of who signed up and where they came from.
- **`waitlist_signup` analytics events** let you slice by `utm_source` and `utm_campaign` to compare channels and campaigns — which ones convert clicks into real emails. Watch `waitlist_bot_blocked` alongside it to gauge how much spam a channel attracts.

The question every campaign answers: _which source and which angle produced qualified signups?_ Tagged links are what make that answerable.

## Files

- **[CAMPAIGNS.md](./CAMPAIGNS.md)** — the live campaign register. Every planned and running alpha campaign, its UTM codes, its tagged URL, and its signup count. Add a row before you send a link.
