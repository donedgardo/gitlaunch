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
src/services/account/**
src/services/invitation/**
src/repositories/membershipRepository.ts
src/repositories/membershipRepository.test.ts
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

| File                                      | FSL part                                   | Enterprise capability inside it    |
| ----------------------------------------- | ------------------------------------------ | ---------------------------------- |
| `src/repositories/accountRepository.ts`   | The account record itself                  | `Plan`, `PlanLimits`, seat caps    |
| `src/server/middleware/accountContext.ts` | Resolving the one account a request is for | Selecting between several accounts |
| `src/repositories/userRepository.ts`      | The user record                            | Future IdP identity fields         |
| `src/server/createAppServer.ts`           | Wiring every route                         | Registering the enterprise routes  |

## Deliberately not enterprise

Recorded because each was considered and rejected, and re-litigating this later
without the reasoning would be worse than the decision itself.

- **`src/services/apiKey/**`and API key auth.** Every`/api/v1/\*`route sits
behind`apiKeyAuth`, and that is how the GitHub Action reports builds. Making
  API keys enterprise would mean a free instance could not receive a build from
  CI, which is the core product loop. Keys are the CI integration seam, not a
  seat feature.
- **`src/services/flag/**` and the feature-flag engine.\*\* Flags are the thing
  people come for; putting them behind a subscription removes the reason to run
  the open-core build at all. They stay FSL, and the Competing Use clause
  already stops someone reselling them as a service.
- **`src/services/analytics/**`.\*\* Same argument — an install with no insight
  into its own deploys is not a product anyone adopts.
- **`src/server/middleware/apiKeyAuth.ts`, `sessionAuth.ts`.** Authenticating a
  single user is not a seat feature.
