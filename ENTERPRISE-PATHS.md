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

`src/services/licensing/licenseBoundary.test.ts` checks this document against
the tree on every `yarn test`: every covered path must exist, every covered
`.ts` and `.hbs` file must carry a header naming the enterprise license, and no
reserved path may exist yet without being promoted.

## Covered paths

```
# Seats, teams and tenancy beyond a single account
src/services/account/teamManagementService.ts
src/services/account/teamManagementService.test.ts
src/services/account/tenantSecurity.test.ts
src/services/invitation/**
src/repositories/invitationRepository.ts
src/repositories/invitationRepository.test.ts
src/server/routes/invite/**
src/server/routes/settings/team.ts
src/server/routes/settings/team.test.ts
src/templates/invite/**
src/templates/settings/team.hbs

# Subscription billing, plans and trials
src/services/billing/**
src/repositories/trialRegistryRepository.ts
src/repositories/trialRegistryRepository.test.ts
src/server/routes/webhooks/**
src/server/routes/settings/billing.ts
src/server/routes/settings/billing.test.ts
src/templates/settings/billing.hbs
src/templates/onboarding/plan-selection.hbs

# Issuing and verifying self-hosted license keys
src/services/licensing/**
scripts/issue-license.ts
scripts/set-distribution.ts
```

## Reserved paths

Enterprise Features that are not written yet. Listed here so the decision is
made once, up front, rather than argued about after the code exists. They are
covered by LICENSE-enterprise.md the moment they land — at which point they move
up to Covered paths and the boundary test starts enforcing their headers.

```
src/services/sso/**
src/server/routes/auth/oidc.ts
src/server/routes/auth/saml.ts
src/server/routes/settings/sso.ts
src/server/routes/settings/license.ts
src/repositories/licenseeRepository.ts
```

## Shared files

Some enterprise capability lives in files a single-seat install genuinely needs
to boot, so the file cannot be listed above without making the open-core product
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

## How the boundary is enforced at runtime

The license is contractual, but the two things it meters are also enforced in code, so
nobody drifts past the line without being told:

- **One account.** `maxAccountsFor()` in `src/services/licensing/resolveEntitlement.ts`
  returns 1 for an unlicensed or lapsed self-hosted instance. `createAppServer` resolves it
  at boot and passes it to the login routes; `ensureAccountForUser` refuses to bootstrap a
  second account and the person is told to ask for an invite.
- **One seat.** `OPEN_CORE_LIMITS.maxUsers` is 1, and the existing
  `PlanEnforcementService.canAddUser` already meters memberships against it.

Everything else stays unmetered on open core. Expiry returns a customer to open core rather
than blocking their install: capacity is granted by the FSL, which was never ours to
withdraw, and no licensing disagreement should be able to break a running pipeline.

## Portability: the enterprise code can be removed

The manifest says which code is commercial. `src/services/limits/portability.test.ts`
says the commercial code could actually be **removed** — it fails if any open-core
file imports from a covered path.

Without that, "enterprise" would be a label on files the free product still depends
on, and the boundary would exist only on paper. With it, the dependency arrow points
one way: enterprise may use core, core may never use enterprise.

Where the open core needs an answer only the commercial code can give, it depends on
a port instead:

| Port                                          | Open-core implementation         | Commercial implementation |
| --------------------------------------------- | -------------------------------- | ------------------------- |
| `AccountLimits` (`services/limits/accountPolicy.ts`) | `OpenCoreLimits`            | `PlanEnforcementService`  |
| `TrialPolicy` (same file)                     | `NO_TRIALS`                      | `TrialService`            |
| `PendingInviteRedeemer` (`services/auth/pendingInvite.ts`) | unsupplied          | `acceptInvitation`        |
| Account cap (a plain `number`)                | `maxAccounts` omitted            | `maxAccountsFor()`        |

Two files are exempt, and only two: `src/index.ts` and `src/server/createAppServer.ts`.
Something has to choose which implementation gets built and which routes get
registered, and confining that to the wiring is the point — removing the enterprise
code is an edit to one composition root, not a search through the tree.

**To actually move the covered paths into `ee/`:** move them, update the imports in
the two composition-root files, add `ee/` to `tsconfig.json`'s `include`, add a
second Handlebars view root in `registerPlugins.ts` and a copy step to `postbuild`.
No feature code changes, because none of it points at the enterprise paths.

**To ship without the enterprise code at all:** delete the covered paths, then in
`createAppServer.ts` swap `PlanEnforcementService`/`TrialService` for
`openCorePolicy(...)`, drop `redeemPendingInvite`, and stop registering the
enterprise routes. `openCorePolicy.test.ts` pins what the result behaves like.

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
- **`src/server/middleware/apiKeyAuth.ts`, `sessionAuth.ts`.** Authenticating a
  single user is not a seat feature.
- **Membership records and role lookup** (`src/repositories/membershipRepository.ts`,
  `src/services/account/accountMembershipService.ts`). A single-seat install
  still has one membership — the owner's — and `accountContext` reads its role on
  every request. Reading a membership is not the paid capability; *adding* one
  is, and that lives in `teamManagementService` and `invitationService`, which
  are covered.
- **`src/services/account/signupGate.ts`.** A feature-flag application, and the
  flag engine is open core. It gates self-serve signups; the single-account cap
  is enforced separately in `ensureAccountForUser`.
- **`src/config/distribution.ts`.** Build identity — which build this is. The
  open-core build has one too, and `loadConfig` reads it to pick defaults. The
  issuer public key it carries is inert without the covered verification code.
