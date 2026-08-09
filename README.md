# GitLaunch

[![CI](https://github.com/donedgardo/launchpad/actions/workflows/ci.yml/badge.svg)](https://github.com/donedgardo/launchpad/actions/workflows/ci.yml)

Deployment control your whole team can drive. GitLaunch shows what's deployed in
every environment and lets anyone promote or roll back in one click, on top of
the CI you already run.

## What it does

- **Deployment tracking** — build history per service, with the current state of every environment
- **One-click promote and rollback** — trigger a deploy from the dashboard or the API
- **Live status** — the dashboard updates over Server-Sent Events, no refresh
- **Multi-tenant** — accounts, roles, per-account API keys, plan limits
- **Feature flags and experiments** — per service and environment, with a ship/no-ship verdict
- **Providers** — GitHub Actions (via a GitHub App) and Jenkins

Stack: Fastify · HTMX · Handlebars · MongoDB · TypeScript · Tailwind CSS

## Deploy your own

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/gitlaunch)

The button provisions GitLaunch and a MongoDB instance together. Running your
own instance is explicitly permitted under the [license](#license). Publishing
the Railway template the button points at is a one-time manual step — see
[docs/railway-template.md](docs/railway-template.md).

Or pull the image directly — every push to `main` publishes
`ghcr.io/donedgardo/gitlaunch`, and every `v*` tag publishes the matching
semver tags:

```bash
docker run -p 3050:3050 \
  -e MONGODB_URI="mongodb://host.docker.internal:27017" \
  -e PUBLIC_URL="http://localhost:3050" \
  -e COOKIE_SECRET_SIGNATURE="$(openssl rand -hex 32)" \
  -e ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  ghcr.io/donedgardo/gitlaunch:latest
```

`ENCRYPTION_KEY` must decode to exactly 32 bytes, so generate it with
`openssl rand -base64 32` rather than by hand — boot fails closed otherwise.

For Kubernetes, see [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md).

## Getting started

Requires Node.js 20+, Yarn, and MongoDB.

```bash
yarn install
git submodule update --init   # github-action submodule; a contract test needs it
cp sample.env .env            # then fill it in
yarn dev                      # http://localhost:3050
```

`sample.env` documents every variable. The minimum to boot is `MONGODB_URI`,
`COOKIE_SECRET_SIGNATURE`, and `ENCRYPTION_KEY` — a 32-byte base64 key
(`openssl rand -base64 32`) that encrypts stored secrets such as Jenkins tokens.
Boot fails closed without a valid one. To rotate it, use the keyring form
(`ENCRYPTION_KEYS` + `ENCRYPTION_PRIMARY_KEY_ID`) so old ciphertexts stay
readable.

To work on the app without real GitHub credentials, set `USE_FAKE_GITHUB=true`
and `ENABLE_BUILD_SIMULATION=true`. For real ones, see
[docs/GitHub_App_Setup.md](docs/GitHub_App_Setup.md).

## Commands

```bash
yarn dev          # server with hot-reload + tailwind watcher
yarn build        # compile to dist/
yarn start        # run the compiled build
yarn test         # unit tests (yarn test:watch for watch mode)
yarn test:e2e     # Playwright e2e, requires a running server
yarn analytics    # internal product/marketing report against $MONGODB_URI
```

## Docs

| Doc                                                           | What's in it                                             |
| ------------------------------------------------------------- | -------------------------------------------------------- |
| [multi-tenancy.md](docs/multi-tenancy.md)                     | Accounts, roles, API keys, plan limits, tenant isolation |
| [feature-flags.md](docs/feature-flags.md)                     | Flags, rollouts, experiments, and the client SDK         |
| [GitHub_App_Setup.md](docs/GitHub_App_Setup.md)               | Creating the GitHub App and wiring its credentials       |
| [railway-setup.md](docs/railway-setup.md)                     | Deploying gitlaunch.dev to Railway, CI/CD, rollback      |
| [railway-template.md](docs/railway-template.md)               | The one-click deploy button and the template behind it   |
| [SELF-HOSTING.md](docs/SELF-HOSTING.md)                       | Running GitLaunch in your own Kubernetes cluster         |
| [ENTERPRISE-DELIVERY.md](docs/ENTERPRISE-DELIVERY.md)         | Internal: licensing and handover for self-hosted sales   |
| [ENTERPRISE-ROADMAP.md](docs/ENTERPRISE-ROADMAP.md)           | Internal: gaps and sequencing for the enterprise push    |
| [product-analytics.md](docs/product-analytics.md)             | The internal analytics report                            |
| [feature-flag-dogfooding.md](docs/feature-flag-dogfooding.md) | GitLaunch running on its own flag engine                 |
| [marketing/](docs/marketing/README.md)                        | Alpha campaigns, UTM convention, waitlist                |
| [positioning/](docs/positioning/README.md)                    | Positioning canvas and customer interviews               |

`CLAUDE.md` covers the architecture and the TDD workflow this repo follows.

## License

The server — everything in this repository except the directories listed below —
is licensed under the [Functional Source License, Version 1.1, ALv2 Future
License](LICENSE.md) (`FSL-1.1-ALv2`).

In short: you may read, modify, and run it for any purpose except a Competing
Use — a commercial product or service that substitutes for GitLaunch. Running
your own instance internally is explicitly permitted, which is what a
self-hosted licensee buys. Each version converts to Apache 2.0 two years after
we make it available.

The client-side pieces are MIT, because nothing else would be usable:

| Path                                                                             | License |
| -------------------------------------------------------------------------------- | ------- |
| `sdk/` (`@gitlaunch/flags`)                                                      | MIT     |
| `github-action/` ([separate repo](https://github.com/donedgardo/build-reporter)) | MIT     |

A self-hosted license key governs entitlement on a customer instance and is
separate from this license — see
[ENTERPRISE-DELIVERY.md](docs/ENTERPRISE-DELIVERY.md).
