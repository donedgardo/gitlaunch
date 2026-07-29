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
| [railway-setup.md](docs/railway-setup.md)                     | Deploying to Railway, CI/CD, rollback                    |
| [SELF-HOSTING.md](docs/SELF-HOSTING.md)                       | Running GitLaunch in your own Kubernetes cluster         |
| [ENTERPRISE-DELIVERY.md](docs/ENTERPRISE-DELIVERY.md)         | Internal: licensing and handover for self-hosted sales   |
| [ENTERPRISE-ROADMAP.md](docs/ENTERPRISE-ROADMAP.md)           | Internal: gaps and sequencing for the enterprise push    |
| [product-analytics.md](docs/product-analytics.md)             | The internal analytics report                            |
| [feature-flag-dogfooding.md](docs/feature-flag-dogfooding.md) | GitLaunch running on its own flag engine                 |
| [marketing/](docs/marketing/README.md)                        | Alpha campaigns, UTM convention, waitlist                |
| [positioning/](docs/positioning/README.md)                    | Positioning canvas and customer interviews               |

`CLAUDE.md` covers the architecture and the TDD workflow this repo follows.

## License

MIT
