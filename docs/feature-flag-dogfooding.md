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

> **These must be set on the running app, not just in CI.** `GITLAUNCH_SERVICE_ID`
> also exists as a GitHub Actions repo variable (`vars.GITLAUNCH_SERVICE_ID`),
> where it only builds the curl URL our workflows report builds to. That does
> **not** reach the server process. Deploys run `railway up`, so the app reads
> its environment from the Railway service's variables — set it there too, or
> every self-flag stays inert no matter what you configure in the flags UI.

Because self-flags fail open, an incomplete setup is invisible at runtime. The
server therefore reports the state on boot, so a look at the logs settles it:

```
GitLaunch's own feature flags are live: reading service 6712… in the "prod" flag environment.
GitLaunch's own feature flags are INERT (…). GITLAUNCH_SERVICE_ID is not set — …
GitLaunch's own feature flags are INERT: no service found for GITLAUNCH_SERVICE_ID=…
```

The three inert cases are unset, malformed (a slug or a pasted dashboard URL
rather than the 24-character id), and a well-formed id with no such service.

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

## Two kinds of key (and why)

GitLaunch reads its own flags **in-process** — `flagService.evaluate` is a plain
method call, no HTTP and no API key. Customers are not so lucky, so the flags
page mints two different keys depending on where the call comes from.

|                                                             | Secret (`sk_…`)             | Publishable (`pk_…`)                            |
| ----------------------------------------------------------- | --------------------------- | ----------------------------------------------- |
| Where it lives                                              | Your server, only           | Your frontend bundle                            |
| Scope                                                       | `flags:read` — account-wide | `flags:evaluate` — one service, one environment |
| Can read flag config / targeting rules / experiment results | Yes                         | **No**                                          |
| Origin restricted                                           | No                          | Yes, to origins you list                        |

`flags:read` is deliberately _not_ browser-safe. It opens six endpoints — flag
config, a single flag, evaluate, experiment results, and two config-version
routes — for **every service in the account**. Flag configuration includes
targeting rules, which can name real users (`githubLogin in [alice, bob]`).

**Legacy keys:** every key minted before this split carries the `pk_` prefix but
is a secret key. What a key may do is read from the stored record, not from its
prefix, so old keys keep working unchanged — but the prefix now reads as
"publishable" to anyone glancing at it. Rotate them to `sk_` when convenient.

**The origin allow-list is a guard rail, not a secret.** A publishable key is
public by construction, and anything outside a browser can forge or omit the
`Origin` header. What actually limits the damage is the confinement: one
service, one environment, evaluate-only. The allow-list stops a key lifted from
your bundle being dropped straight into another site's frontend.

**No rate limiting yet.** The evaluate endpoint has no per-key throttle, so a
publishable key can be replayed as fast as someone likes. Worth adding before
this is load-bearing for a large customer.
