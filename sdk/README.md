# @gitlaunch/flags

The client for GitLaunch feature flags, gradual rollouts and A/B experiments.
No dependencies. Runs on a server (Node 18+) and in the browser.

For what flags, rollouts and experiments _are_ in GitLaunch, and how to read the
results, see [docs/feature-flags.md](../docs/feature-flags.md). This file is the
library reference.

## Install

```bash
npm install @gitlaunch/flags
```

## Create a client

```ts
import { createFlagClient } from "@gitlaunch/flags";

const flags = createFlagClient({
  apiUrl: "https://gitlaunch.dev",
  serviceId: "665f…", // from your flags page URL: /services/:serviceId/flags
  environment: "prod",
  apiKey: process.env.GITLAUNCH_FLAG_KEY!, // sk_… on a server, pk_… in a browser
});
```

| Option        | Default            | What it does                                                             |
| ------------- | ------------------ | ------------------------------------------------------------------------ |
| `apiUrl`      | —                  | Where GitLaunch lives                                                    |
| `serviceId`   | —                  | The service whose flags you are reading                                  |
| `environment` | —                  | Which environment's config to evaluate (`prod`, `staging`, `eu-west`, …) |
| `apiKey`      | —                  | Secret key on a server, publishable key in a browser                     |
| `bundleUrl`   | —                  | Evaluate locally from a published bundle instead of the API — see below  |
| `ttlMs`       | `30000`            | How long decisions are reused before re-fetching                         |
| `timeoutMs`   | `1500`             | How long to wait before giving up and using your fallback                |
| `onError`     | —                  | Called with any network/API failure — wire it to your logger             |
| `fetch`       | `globalThis.fetch` | Inject your own (tests, proxies, custom agents)                          |
| `now`         | `Date.now`         | Inject a clock (tests)                                                   |

## Check a flag

```ts
const context = { entity: user.id, attributes: { plan: user.plan } };

if (await flags.isEnabled("new-checkout", context)) {
  renderNewCheckout();
}

const copy = await flags.variant("hero-copy", context, "control");
```

`entity` is whoever is being bucketed — a user id, an account id, an anonymous
visitor cookie. The same entity always gets the same answer, so nobody sees a
feature flicker between page loads. `attributes` are what targeting rules match
on (`plan`, `country`, `githubLogin`, …).

The last argument is your fallback: what to use when the flag does not exist, or
when GitLaunch cannot be reached. **Pick the value that is safe to ship** —
usually the behaviour you have today.

## Record a conversion

An experiment is exposure plus conversion. Checking the flag records the
exposure; you record the conversion when the thing you are optimising for
happens.

```ts
await flags.track("new-checkout", {
  entity: user.id,
  goal: "purchase",
  value: 49,
});
```

You never pass a variant. GitLaunch re-derives it from the same deterministic
bucketing, so a conversion cannot be attributed to the wrong arm.

## What it does for you

- **One round trip per entity, not per flag.** The first check fetches every
  flag's decision for that entity; later checks are answered from memory until
  `ttlMs` expires.
- **Concurrent checks share a request.** Ten `isEnabled` calls at once make one
  network call.
- **It never throws and never hangs.** Past `timeoutMs`, or on any network
  error, you get your fallback. `track` returns `false` instead of throwing —
  measurement failing must not break the feature.
- **An outage does not flip everyone.** If a refresh fails but decisions were
  fetched earlier, the last known ones keep being served rather than falling
  back — they are what that entity already saw.
- **Attributes are part of a decision's identity.** A cached free-plan answer is
  not served to the same user once they upgrade.

## Other methods

```ts
await flags.evaluate(context); // every flag's decision for this entity
await flags.refresh(context); // force a re-fetch, ignoring the cache
```

## Evaluating from a published bundle

In a browser, every flag check is one of _your_ end users hitting GitLaunch's
servers. Pass `bundleUrl` (shown on your service's settings page once bundle
publishing is configured) and decisions are computed locally from a fetched,
CDN-cacheable config bundle instead:

```ts
const flags = createFlagClient({
  apiUrl: "https://gitlaunch.dev",
  serviceId: "665f…",
  environment: "prod",
  apiKey: process.env.NEXT_PUBLIC_GITLAUNCH_FLAG_KEY!,
  bundleUrl: "https://flags-cdn.example.com/flags/AbC123.../prod.json",
});
```

Everything else about the client is unchanged — same methods, same caching,
same fallback behavior. If the bundle can't be fetched (a CDN outage, an ad
blocker, a stale URL after rotating it), the client falls straight through to
the HTTP evaluate endpoint, so this is a pure optimization: nothing regresses
without it. One caveat: a `pk_` key's origin allow-list only governs the HTTP
path — the bundle URL has no per-request check at all. That's fine, not a
secret to protect: once it's in your frontend it's public the same way your
compiled JS is. Rotate it from the settings page when you want to retire an
old URL (a decommissioned build, say), not because something "leaked." See
[docs/feature-flags.md#bundle-publishing](../docs/feature-flags.md#bundle-publishing)
for how publishing works.

## Which key?

|          | Secret (`sk_…`)         | Publishable (`pk_…`)                               |
| -------- | ----------------------- | -------------------------------------------------- |
| Where    | Your server only        | Safe in browser JS                                 |
| Can      | Everything flag-related | Evaluate + record conversions, nothing else        |
| Bound to | The whole account       | One service, one environment, an origin allow-list |

Mint either from your service's flags page under **Connect an app**. Never ship
a secret key to a browser, a mobile app, or a public repo.

## Not using JavaScript?

Everything here is two HTTP calls. See
[docs/feature-flags.md](../docs/feature-flags.md#the-http-api) for the raw
endpoints.
