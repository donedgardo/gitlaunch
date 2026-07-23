# Dogfooding our own feature flags

GitLaunch runs some of its own product behaviour through its own flag engine. It
is a customer of its own multi-tenant flag service: our flags live under one
GitLaunch service, and each internal feature differs only by flag key.

## Wiring

Two env vars, both already used elsewhere:

| Variable               | Meaning                                                                     |
| ---------------------- | --------------------------------------------------------------------------- |
| `GITLAUNCH_SERVICE_ID` | The GitLaunch service our own flags live under (from `/services/:id/flags`) |
| `GITLAUNCH_FLAG_ENV`   | Which flag environment to read (default `prod`)                             |

The owning account is derived from the service — a service belongs to exactly
one account — so there is no account id to configure. If `GITLAUNCH_SERVICE_ID`
is unset or points at a missing service, every self-flag is **inert**.

## Flags we run on ourselves

| Key                  | What it controls                                  | Off/absent behaviour        |
| -------------------- | ------------------------------------------------- | --------------------------- |
| `waitlist-hero-copy` | A/B variant of the landing-page copy              | Control copy (today's page) |
| `self-serve-signups` | Whether a brand-new visitor may create an account | See below — fails **open**  |

## `self-serve-signups` — the front door

Flag **on** => a visitor with no membership can create an account. What that
buys us, without a deploy:

- **Kill switch** — turn signups off during an incident or when the alpha is full.
- **Gradual opening** — `rolloutPercentage` admits a deterministic slice of new
  visitors (bucketed by GitHub user id, so a retry keeps the same answer).
- **Allow-lists** — a targeting rule on `githubLogin`
  (`githubLogin in [alice, bob]` => serve on) lets named people in while the
  door is otherwise shut.

It only gates **creating a new account**. Existing customers signing in, and
invited teammates redeeming an invite, are never blocked by it.

**It fails open.** No service configured, flag never created, or the flag store
throwing all resolve to "signup allowed". A flag outage must not be able to lock
new customers out; closing the door is only ever an explicit act.

**Footgun:** a newly created flag defaults to `enabled: false`, so creating
`self-serve-signups` in the UI closes signups the moment it exists. Enable it in
the environment you care about right after creating it.

Every decision emits a `flag_exposure` analytics event (`allowed`, `reason`,
`variant`, keyed by the prospect), so the block rate is visible in the warehouse
alongside every other flag. A refused visitor is redirected to
`/?error=signups_closed`, which tells them the alpha is invite-only and points
them at the waitlist.
