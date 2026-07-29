# Multi-tenancy

Every piece of data in GitLaunch belongs to an **account**. Users belong to
accounts through memberships, and each account carries its own plan, limits,
billing and API keys.

## The model

| Collection     | What it is                                                                   |
| -------------- | ---------------------------------------------------------------------------- |
| `accounts`     | The tenant. Owns everything else. Holds plan, limits, Stripe and trial state |
| `users`        | A person. Carries their provider identities (GitHub, Google, password hash)  |
| `memberships`  | Which users are in which account, and with what role                         |
| `services`     | A deployable thing, with its own environments and provider connection        |
| `repositories` | A connected GitHub repo                                                      |
| `builds`       | Build records and their per-environment deployment status                    |
| `apiKeys`      | Per-account keys, stored as bcrypt hashes                                    |
| `invitations`  | Pending invites, valid for 7 days                                            |

An account is created automatically on first sign-in, so nobody lands in the app
without a tenant. Sign-in is GitHub OAuth, Google OAuth, or email/password.

**Isolation is enforced in the repository layer**: every tenant-scoped query
filters by `accountId`. Route handlers resolve the current account through the
`accountContext` middleware and never take one from user input.

## Roles

| Role   | Can                                                    |
| ------ | ------------------------------------------------------ |
| Owner  | Everything, including billing and deleting the account |
| Admin  | Manage services, repos, team and API keys              |
| Member | View the dashboard and trigger deployments             |

## Plans and limits

Limits live in `src/repositories/accountRepository.ts` — that file is the source
of truth, not this table.

| Limit         | Free | Pro | Team |
| ------------- | ---- | --- | ---- |
| Repositories  | 3    | 10  | 999  |
| Services      | 3    | 10  | 999  |
| Users         | 1    | 5   | 999  |
| Environments  | 2    | 10  | 999  |
| Private repos | ✗    | ✓   | ✓    |

`planEnforcementService` checks a limit before anything is created, so exceeding
one fails at creation time rather than corrupting state.

A 14-day trial can be claimed once per subject, tracked in a trial registry so
the same person cannot re-trial through a new account. Trials cannot start on
Free.

Billing is Stripe Checkout plus the customer portal. The webhook endpoint
verifies signatures through an injected `StripeSignatureVerifier` and handles
checkout completion, subscription deletion, and payment success/failure.

## API keys

Minted per account at `/settings/api-keys`, and per service under **Connect an
app** on the flags page. The full key is shown once; only a bcrypt hash is
stored.

- **Secret keys (`sk_`)** live on your server and can carry any scope.
- **Publishable keys (`pk_`)** are for browser code. They may only carry
  `flags:evaluate`, and are confined to one service, one environment, and an
  allow-list of origins.

Scopes: `builds:read`, `builds:write`, `deployments:write`, `services:read`,
`services:write`, `flags:read`, `flags:write`, `flags:evaluate`.

> **Legacy keys:** keys minted before the secret/publishable split carry the
> `pk_` prefix but are secret keys. Capability is read from the stored record,
> not the prefix, so they keep working — rotate them to `sk_` when convenient.

See [feature-flags.md](./feature-flags.md) for what each flag scope opens up.
