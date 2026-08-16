# Enterprise paths

Which files in this repository are Enterprise Features under
[LICENSE-enterprise.md](LICENSE-enterprise.md), and which are open core under
[LICENSE.md](LICENSE.md) (`FSL-1.1-ALv2`).

**The default is open core.** A path is an Enterprise Feature only if it is
listed below. Anything not listed is FSL, including anything added later.

The line is: **open core is one account and one seat.** Deployment tracking,
promote and rollback, live status, providers, feature flags and the API are all
FSL — a single-tenant install is a complete product, not a demo. What is sold is
running a team on it (seats, invitations, roles), signing in through an IdP, and
the machinery of selling it (billing, plans, license keys).

## The short version: it is `ee/`

The commercial code lives in one directory. **Everything under `ee/` is an
Enterprise Feature; everything else is FSL.** `ee/` mirrors `src/` — `ee/services/`,
`ee/repositories/`, `ee/server/routes/`, `ee/scripts/` — so a file's place in the
tree still says what it is, and its licence is now readable from its path.

Four things are true of that directory, and each is enforced by a test rather
than asserted here:

| Claim | Enforced by |
| --- | --- |
| Every path claimed as commercial exists, and every `.ts`/`.hbs` under it carries the header | `src/services/limits/licenseBoundary.test.ts` |
| No file outside `ee/` carries the header | same |
| No open-core file imports from `ee/`, bar the composition root | `src/services/limits/portability.test.ts` |
| No open-core **test** imports from `ee/`, bar two recorded exceptions | same |

Both tests live in `src/services/limits/` — in the open core, deliberately. A
boundary check that shipped inside `ee/` would be deleted along with it, and the
deletion is exactly the moment the claim needs verifying.

## Covered paths

```
# The commercial tree, in full
ee/**

# Handlebars templates rendered by the enterprise routes. They cannot move
# into ee/ yet — see "Why the templates are still in src/" below.
src/templates/invite/**
src/templates/settings/team.hbs
src/templates/settings/billing.hbs
src/templates/onboarding/plan-selection.hbs
```

What that directory holds:

- **Seats and teams** — `ee/services/account/teamManagementService.ts`,
  `ee/services/invitation/`, `ee/repositories/invitationRepository.ts`,
  `ee/server/routes/invite/`, `ee/server/routes/settings/team.ts`
- **Subscription billing, plans and trials** — `ee/services/billing/`,
  `ee/repositories/trialRegistryRepository.ts`, `ee/server/routes/webhooks/`,
  `ee/server/routes/settings/billing.ts`
- **Issuing and verifying self-hosted license keys** — `ee/services/licensing/`,
  `ee/scripts/issue-license.ts`, `ee/scripts/set-distribution.ts`

## Reserved paths

Enterprise Features that are not written yet. Listed here so the decision is
made once, up front, rather than argued about after the code exists. They are
covered by LICENSE-enterprise.md the moment they land — and since they land
under `ee/`, coverage and header enforcement start on their own.

```
ee/services/sso/**
ee/server/routes/auth/oidc.ts
ee/server/routes/auth/saml.ts
ee/server/routes/settings/sso.ts
ee/server/routes/settings/license.ts
ee/repositories/licenseeRepository.ts
```

## How the code is built and removed

`ee/` is compiled by the same `tsconfig.json` as `src/`, which is why `rootDir`
is the repository root and the build lands in `dist/src/` and `dist/ee/`. `dist/`
mirrors the repository root, so paths resolved relative to a compiled file work
the same in `dist/` as they do in `src/` — `postbuild` copies `skills/` in for
the same reason.

**To ship without the commercial code:** delete `ee/`, drop `COPY ee ./ee` from
the `Dockerfile`, and edit the two composition-root files. In
`createAppServer.ts`, swap `PlanEnforcementService`/`TrialService` for
`openCorePolicy(...)`, drop `redeemPendingInvite`, and stop registering the
enterprise routes; in `index.ts`, drop the trial registry.
`src/services/limits/openCorePolicy.test.ts` pins what the result behaves like,
and `portability.test.ts` is what guarantees there is nothing else to find.

## Shared files

Some enterprise capability lives in files a single-seat install genuinely needs
to boot, so the file cannot move into `ee/` without making the open-core product
unrunnable. Those files stay FSL. The capability inside them is still an
Enterprise Feature under clause 2 of LICENSE-enterprise.md, which is written
against capabilities and not only paths.

| File                                      | FSL part                                     | Enterprise capability inside it    |
| ----------------------------------------- | -------------------------------------------- | ---------------------------------- |
| `src/repositories/accountRepository.ts`   | The account record itself                    | `Plan`, `PlanLimits`, seat caps    |
| `src/server/middleware/accountContext.ts` | Resolving the one account a request is for   | Selecting between several accounts |
| `src/repositories/userRepository.ts`      | The user record                              | Future IdP identity fields         |
| `src/server/createAppServer.ts`           | Wiring every route                           | Registering the enterprise routes  |
| `src/services/auth/accountBootstrap.ts`   | Bootstrapping the one account on first login | The cap that keeps it to one       |
| `src/server/routes/auth/*.ts`             | Signing a single user in                     | Passing and honouring that cap     |

### Why the templates are still in `src/`

`@fastify/view` v9 takes a **single** template root for Handlebars — an array of
roots is Nunjucks-only (`templatesDirIsValid` in the plugin rejects it). A second
`ee/templates` root would therefore need its own registration under a different
`reply.view` property name, and its own copy of `layouts/main.hbs` and the shared
partials. Duplicating the layout to relocate five files buys less clarity than it
costs, so the five stay under `src/templates`, carry the header, and are named
individually in Covered paths above.

They move the day the view engine resolves a page against more than one root, or
the day the app assembles a merged template directory at boot.

## Known gaps

Recorded because the `ee/` move made them visible, and an unrecorded gap is one
that gets rediscovered as a surprise.

**Plan selection is commercial behaviour served by a core route.**
`src/server/routes/onboarding/index.ts` renders `onboarding/plan-selection.hbs`
and handles `POST /onboarding/select-plan`. Both are billing, and both sit in the
open core; the route is what forces `src/templates/onboarding/plan-selection.hbs`
to stay reachable from FSL code. Extracting them into
`ee/server/routes/onboarding/` is the fix, and it is a behaviour-affecting change
to the onboarding flow, so it is not bundled with the file move.

Its consequence is the two entries in `ENTERPRISE_COUPLED_TESTS`
(`portability.test.ts`): open-core tests that reach into `ee/` because the
capability they cover is still reachable from a core route. They are exceptions
with an expiry — when the routes move, the exceptions go with them.

## Portability: the enterprise code can be removed

The manifest says which code is commercial. `portability.test.ts` says the
commercial code could actually be **removed** — it fails if any open-core file
imports from a covered path.

Without that, "enterprise" would be a label on files the free product still
depends on, and the boundary would exist only on paper. With it, the dependency
arrow points one way: enterprise may use core, core may never use enterprise.

Where the open core needs an answer only the commercial code can give, it depends
on a port instead:

| Port                                                       | Open-core implementation | Commercial implementation |
| ---------------------------------------------------------- | ------------------------ | ------------------------- |
| `AccountLimits` (`services/limits/accountPolicy.ts`)       | `OpenCoreLimits`         | `PlanEnforcementService`  |
| `TrialPolicy` (same file)                                  | `NO_TRIALS`              | `TrialService`            |
| `PendingInviteRedeemer` (`services/auth/pendingInvite.ts`) | unsupplied               | `acceptInvitation`        |
| Account cap (a plain `number`)                             | `maxAccounts` omitted    | `maxAccountsFor()`        |

Two files are exempt, and only two: `src/index.ts` and `src/server/createAppServer.ts`.
Something has to choose which implementation gets built and which routes get
registered, and confining that to the wiring is the point — removing the enterprise
code is an edit to one composition root, not a search through the tree.

## How the boundary is enforced at runtime

The license is contractual, but the two things it meters are also enforced in code, so
nobody drifts past the line without being told:

- **One account.** `maxAccountsFor()` in `ee/services/licensing/resolveEntitlement.ts`
  returns 1 for an unlicensed or lapsed self-hosted instance. `createAppServer` resolves it
  at boot and passes it to the login routes; `ensureAccountForUser` refuses to bootstrap a
  second account and the person is told to ask for an invite.
- **One seat.** `OPEN_CORE_LIMITS.maxUsers` is 1, and the existing
  `PlanEnforcementService.canAddUser` already meters memberships against it.

Everything else stays unmetered on open core. Expiry returns a customer to open core rather
than blocking their install: capacity is granted by the FSL, which was never ours to
withdraw, and no licensing disagreement should be able to break a running pipeline.

## Deliberately not enterprise

Recorded because each was considered and rejected, and re-litigating this later
without the reasoning would be worse than the decision itself.

- **API keys** (`src/services/apiKey/`). Every `/api/v1/` route sits behind
  `apiKeyAuth`, and that is how the GitHub Action reports builds. Making API
  keys enterprise would mean a free instance could not receive a build from CI,
  which is the core product loop. Keys are the CI integration seam, not a seat
  feature.
- **The feature-flag engine** (`src/services/flag/`). Flags are the thing people
  come for; putting them behind a subscription removes the reason to run the
  open-core build at all. They stay FSL, and the Competing Use clause already
  stops someone reselling them as a service.
- **Product analytics** (`src/services/analytics/`). Same argument — an install
  with no insight into its own deploys is not a product anyone adopts.
- **The PostHog sink** (`src/services/analytics/posthogAnalytics.ts`,
  `createPostHogClient.ts`). Worth naming separately, because it looks like
  vendor machinery that belongs with the commercial code: it is disabled on a
  self-hosted build, since a customer's install must never report their usage to
  our project. But that switch is what makes it _safe_ to ship, not a reason to
  sell it. It is one more destination behind the `AnalyticsService` port, and a
  self-hosted operator is free to point their own sink at their own project.
  Charging for the ability to send your own telemetry somewhere would be a tax on
  the open-core build, not a seat feature.
- **DORA delivery metrics** (`src/services/dora/`, `src/server/routes/api/dora.ts`,
  `src/server/routes/services/metrics.ts`). Deployment frequency, lead time,
  change-failure rate and MTTR are read off deploys the install already recorded
  — they are the deployment tracking this product exists to do, reported back.
  A single-seat install has four keys worth reading, and gating them would leave
  the free build able to deploy but not to tell you how it is going. What is sold
  is running a _team_ on it, not learning how your own deploys went.
- **`src/server/middleware/apiKeyAuth.ts`, `sessionAuth.ts`.** Authenticating a
  single user is not a seat feature.
- **Membership records and role lookup** (`src/repositories/membershipRepository.ts`,
  `src/services/account/accountMembershipService.ts`). A single-seat install
  still has one membership — the owner's — and `accountContext` reads its role on
  every request. Reading a membership is not the paid capability; _adding_ one
  is, and that lives in `teamManagementService` and `invitationService`, which
  are covered.
- **`src/services/account/signupGate.ts`.** A feature-flag application, and the
  flag engine is open core. It gates self-serve signups; the single-account cap
  is enforced separately in `ensureAccountForUser`.
- **`src/config/distribution.ts`.** Build identity — which build this is. The
  open-core build has one too, and `loadConfig` reads it to pick defaults. The
  issuer public key it carries is inert without the covered verification code.
  `ee/scripts/set-distribution.ts` stamps it, but the stamped file is FSL.
