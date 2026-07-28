# Feature flags, rollouts and experiments

Ship code without shipping the feature, turn it on for a slice of users, and let
the numbers decide whether it stays. Three jobs, one flag:

| Job            | What you change             | What you get                                            |
| -------------- | --------------------------- | ------------------------------------------------------- |
| **Gate**       | `enabled` on/off            | A kill switch that needs no deploy                      |
| **Rollout**    | `rolloutPercentage` 0 → 100 | A deterministic slice of users sees the feature         |
| **Experiment** | `variants` with weights     | Per-variant conversion rates and a ship/no-ship verdict |

Flags live on a **service** and are configured **per environment**, so `prod`
and `staging` are independent. Find yours at `/services/:serviceId/flags`.

## Quickstart

1. Create a flag on your service's flags page — say `new-checkout`.
2. Under **Connect an app**, mint a key: a secret key (`sk_…`) if you call from
   your server, a publishable key (`pk_…`) if you call from browser JavaScript.
3. Install the client and check it:

```bash
npm install @gitlaunch/flags
```

```ts
import { createFlagClient } from "@gitlaunch/flags";

const flags = createFlagClient({
  apiUrl: "https://gitlaunch.dev",
  serviceId: "665f…",
  environment: "prod",
  apiKey: process.env.GITLAUNCH_FLAG_KEY!,
});

if (await flags.isEnabled("new-checkout", { entity: user.id })) {
  renderNewCheckout();
}
```

> **A new flag starts off.** Creating `new-checkout` does not enable it
> anywhere. Turn it on per environment when you are ready.

Full client reference: [sdk/README.md](../sdk/README.md).

## The entity is the whole game

Every evaluation needs an **entity** — a stable identifier for whoever is being
bucketed. A user id, an account id, or an anonymous visitor cookie you mint on
first visit.

Bucketing is deterministic: the same entity and the same config always produce
the same answer, on every server, with no coordination. That is what makes a 10%
rollout mean "the same 10% of people", not "10% of page loads". Pass a random id
per request and every user will see the feature flicker.

Attributes ride alongside the entity and are what **targeting rules** match on:

```ts
await flags.isEnabled("new-checkout", {
  entity: user.id,
  attributes: { plan: user.plan, country: user.country },
});
```

A rule like `plan in [pro, enterprise] → serve on` is checked **before** the
rollout percentage, so explicit targeting always wins. A missing attribute never
matches a rule — including negative operators.

## Rolling out gradually

Set `rolloutPercentage` on the environment and raise it: 1 → 5 → 25 → 100.
Because bucketing is deterministic and monotonic, everyone who was in at 5% is
still in at 25%. Nobody loses the feature as you widen it.

Drop it back to `0`, or flip `enabled` off, to kill the feature instantly — no
deploy, no rollback.

## Running an experiment

Give the flag variants with weights instead of a plain on/off:

```json
{
  "enabled": true,
  "rolloutPercentage": 100,
  "variants": [
    { "key": "control", "weight": 50 },
    { "key": "benefit-led", "weight": 50 }
  ]
}
```

Then branch on the variant, and report the thing you are trying to move:

```ts
const context = { entity: visitorId };

const copy = await flags.variant("hero-copy", context, "control");
render(HEADLINES[copy]);

// …later, when they convert
await flags.track("hero-copy", { ...context, goal: "signup" });
```

Checking the flag records the **exposure**. `track` records the **conversion**.
You never pass a variant — GitLaunch re-derives it from the same bucketing, so a
conversion cannot land on the wrong arm.

### Reading the result

The **Results** panel on the flags page shows one section per environment, each
with its own verdict:

| Badge                | Means                                                                       |
| -------------------- | --------------------------------------------------------------------------- |
| `Ship <variant>`     | That arm beat the baseline, significantly, with enough traffic to trust it  |
| `Keep <baseline>`    | The challenger is not winning — stop it and keep what you have              |
| `Keep running`       | Not enough evidence yet; the panel tells you how many more per arm you need |
| `Nothing to compare` | No exposures recorded yet                                                   |

Two deliberate rules behind that badge:

- **A leader is not a winner until the smallest arm has enough traffic.** An
  early lead flips often; a panel you can refresh invites you to stop at the
  first lucky peek, which turns a 5% false-positive rate into ~19% by the tenth
  look. When an arm is ahead but not yet callable, the panel says so explicitly
  rather than claiming nothing has separated.
- **Stopping a challenger is not gated the same way.** Abandoning a variant
  leaves you with the status quo, so killing a harmful one early is fine. The
  expensive mistake is _shipping_ on noise.

Environments are independent experiments, never pooled — different traffic mixes
across environments invite Simpson's paradox. `prod` can read `Ship` while `dev`
still reads `Keep running`.

## Keys and safety

|             | Secret (`sk_…`)                               | Publishable (`pk_…`)                                   |
| ----------- | --------------------------------------------- | ------------------------------------------------------ |
| Lives in    | Your server, your secret store                | Your browser bundle — it is public by design           |
| Can do      | Everything flag-related for the whole account | Evaluate flags and record conversions. Nothing else    |
| Confined to | Nothing — account-wide                        | One service, one environment, an allow-list of origins |

Mint both under **Connect an app** on the flags page. A publishable key refuses
to be created without an origin allow-list.

Be honest about what that allow-list is: a guard rail, not a secret. A browser
enforces `Origin`; anything outside a browser can forge it. It stops a key
lifted from your bundle being dropped into someone else's site. What actually
bounds the damage is the confinement — one service, one environment, and only
the two runtime endpoints. A leaked publishable key can add conversion noise to
your experiments, which is the accepted cost of measuring front-end tests at
all.

## The HTTP API

Not on JavaScript? It is two calls.

**Evaluate every flag for an entity** (`flags:evaluate` or `flags:read`):

```bash
curl -H "Authorization: Bearer $KEY" \
  "$API/api/v1/services/$SERVICE/environments/prod/flags/evaluate?entity=user-123&attr.plan=pro"
```

```json
{
  "environment": "prod",
  "entity": "user-123",
  "flags": {
    "new-checkout": {
      "enabled": true,
      "variant": "benefit-led",
      "reason": "variant"
    }
  }
}
```

`reason` tells you _why_: `disabled`, `rollout`, `variant`, `targeting_rule`,
`missing`.

**Record a conversion** (`flags:evaluate` or `flags:read`):

```bash
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"entity":"user-123","goal":"purchase","value":49}' \
  "$API/api/v1/services/$SERVICE/environments/prod/flags/new-checkout/conversions"
```

Management endpoints, all requiring a secret key:

| Method   | Path                                                        | Scope         |
| -------- | ----------------------------------------------------------- | ------------- |
| `POST`   | `/api/v1/services/:id/flags`                                | `flags:write` |
| `GET`    | `/api/v1/services/:id/flags`                                | `flags:read`  |
| `GET`    | `/api/v1/services/:id/flags/:key`                           | `flags:read`  |
| `PATCH`  | `/api/v1/services/:id/flags/:key/environments/:env`         | `flags:write` |
| `DELETE` | `/api/v1/services/:id/flags/:key`                           | `flags:write` |
| `GET`    | `/api/v1/services/:id/environments/:env/flags/:key/results` | `flags:read`  |
| `GET`    | `/api/v1/services/:id/environments/:env/config/versions`    | `flags:read`  |
| `GET`    | `/api/v1/services/:id/environments/:env/config/versions/:v` | `flags:read`  |

## Config versions

Every change to a flag's evaluation config publishes an immutable, content-hashed
snapshot of that environment's flags. Fetch `…/config/versions/latest` (or a
number) to get the exact bundle that was live, for auditing, pinning or
reproducing a past decision. Versions only mint when behaviour changes — editing
a description does not create one.

## Gotchas

- **A new flag is off everywhere.** If your code gates on it, creating it turns
  the feature off until you enable it per environment.
- **Environments are not a ladder.** `dev`, `staging`, `prod`, `eu-west` are
  parallel and independent. Nothing promotes automatically.
- **Pick a fallback that is safe to ship.** It is what your users get when
  GitLaunch is unreachable — usually today's behaviour.
- **Keep the entity stable across the funnel.** If the exposure is bucketed by a
  visitor cookie and the conversion is reported with a user id, they are two
  different entities and the conversion will not attribute.
