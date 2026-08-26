# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

```bash
# Install dependencies
yarn install

# Development (runs server with hot-reload + tailwind watcher)
yarn dev

# Build TypeScript to dist/
yarn build

# Start production build
yarn start

# Run unit tests
yarn test

# Run unit tests in watch mode
yarn test:watch

# Run e2e tests (requires server running)
yarn test:e2e
```

## Architecture

GitLaunch is a multi-tenant SaaS deployment tool: Fastify, HTMX, Handlebars, MongoDB, Tailwind.

### Core Structure

**Entry point**: `src/index.ts` — reads config, connects MongoDB, constructs services, listens on `PORT` (default 3050).

**Server** (`src/server/`):

- `createAppServer.ts` - Creates the Fastify server and registers every route
- `registerPlugins.ts` - Fastify plugins (static files, views, cookies, OAuth2, SSE, raw body)
- `routes/` - `api/`, `auth/`, `github/`, `invite/`, `marketing/`, `onboarding/`, `services/`, `settings/`, `webhooks/`
- Feature dirs alongside them: `build/`, `dashboard/`, `home/`, `health/`, `analytics/`, `seo/`
- `middleware/` - session auth, API key auth, account context

**Data** (`src/repositories/`): one repository per collection — accounts, users, memberships, services, repositories, builds, API keys, invitations, leads, flags, analytics events, webhook events, trial registry. Every tenant-scoped query filters by `accountId`.

**Services** (`src/services/`): grouped by domain — `account/`, `analytics/`, `apiKey/`, `auth/`, `billing/`, `build/`, `crypto/`, `dispatch/`, `environment/`, `flag/`, `github/`, `invitation/`, `jenkins/`, `marketing/`, `repository/`.

### Key Patterns

**Dependency injection**: services are constructed in `src/index.ts` and injected into route handlers. Nothing reaches for a global.

**Providers**: `dispatch/providerDispatcher.ts` routes a deploy to GitHub Actions or Jenkins based on the service's connection.

**Real-time updates**: Server-Sent Events via `EventEmitter` push deployment status to the dashboard (`/build-update-stream`).

**Deployment status flow**: `none` -> `dispatching` -> `deploying` -> `deployed`/`error`/`cancelled` (`services/service/deploymentStatus.ts`).

**Environments** are per-service records, not a fixed enum — a service defines its own (`staging`, `prod`, whatever), capped by plan limits.

### API Patterns

- UI routes render Handlebars templates, updated in place with HTMX, authenticated by session cookie
- Programmatic routes live under `/api/v1/services/:serviceId/...` and authenticate with an API key
- API keys are scoped (`builds:read/write`, `deployments:write`, `services:read/write`, `flags:read/write/evaluate`); publishable (`pk_`) keys may only carry `flags:evaluate`

### Build reporting: `curl` is canonical

There is one answer to "how do I report a build to GitLaunch?" — plain `curl` against the REST API, emitted by `src/services/setup/setupSnippets.ts`. That file backs the onboarding UI, the per-service settings page, `GET /api/v1/services/:serviceId/setup-snippets` and the `gitlaunch-onboarding` skill, and the same shape serves GitHub Actions, Jenkins, GitLab CI and the `raw` provider alike. One code path, one source of truth, every provider and every surface.

The `github-action` submodule — `donedgardo/build-reporter`, listed on the GitHub Marketplace as "GitLaunch Build Reporter" — is **deprecated, not deleted**. Its published releases (`v1`, `v2`) keep working against an unchanged API, so no existing pipeline breaks. It gets no new features, and it must not reappear in a snippet, a template, or a skill.

The costs were weighed and accepted, so this does not need relitigating: we give up the Marketplace listing as a discovery channel, and the GitHub build-report snippet keeps its `jq` dependency (present on `ubuntu-latest`, absent on many slim containers and self-hosted runners — remedies are in `skills/gitlaunch-onboarding/references/troubleshooting.md`). Both were judged cheaper than maintaining a second way to report a build that only ever covered one provider.

The golden status contract outlives the action. `src/services/dispatch/contract/reporter-contract.golden.json` is read by `reporterContract.test.ts` (status vocabulary against the `DeploymentStatus` enum), `setupSnippets.test.ts` and `ownCiDogfood.test.ts` — none of which need the submodule. Only `reporterContractDrift.test.ts` does, and it stays for as long as the action does: it is what stops an edit here from silently breaking a pipeline still on the action.

### Testing

- Unit tests: `*.test.ts` alongside the source file
- Smoke tests: `src/tests/` (`yarn test:smoke`)
- E2E: `e2e/` with Playwright (`yarn test:e2e`, requires a running server)
- Use the existing fakes rather than mocking internals: `FakeGitHubAppClient`, `FakeGitHubApiClient`, `FakeHttpClient`, `FakeStripeClient`, `FakeFlags`

`github-action` is a git submodule; run `git submodule update --init` in a fresh clone or worktree or the reporter contract drift test fails. See **Build reporting** above for why it is still checked in.

### Licensing boundary

This repo is open core, and the split is a directory: **`src/` is FSL-1.1-ALv2 (`LICENSE.md`), `ee/` is commercial (`LICENSE-enterprise.md`).** `ee/` mirrors `src/` — `ee/services/`, `ee/repositories/`, `ee/server/routes/`, `ee/scripts/`. `ENTERPRISE-PATHS.md` is the manifest of record and names the handful of exceptions. The line is one account and one seat: multi-seat, SSO, billing and license issuance are sold; deployment tracking, flags, analytics and the API are not.

When you add code:

- Building a seat/SSO/billing/licensing feature? Put the file under `ee/`, at the path mirroring where it would live in `src/`, and head it with `// GitLaunch Enterprise Feature — licensed under LICENSE-enterprise.md, not the FSL.` (`{{!-- … --}}` in `.hbs`). `ee/**` is already covered by the manifest, so there is nothing to add there.
- Anything else defaults to FSL and belongs in `src/`. Don't file something under `ee/` to be safe — a wrong claim of coverage is worse than none.
- **Never import from `ee/` in open-core code.** If the core needs an answer only enterprise code can give, define a port in the core and inject the implementation (see `src/services/limits/accountPolicy.ts` for the pattern, and its open-core default in `openCorePolicy.ts`). Only `src/index.ts` and `src/server/createAppServer.ts` may know both sides.
- **That applies to tests too.** A core route test needs _an_ `AccountLimits`, not the commercial one — use `OpenCoreLimits`, or `FakeAccountLimits` (`src/services/limits/fakes.ts`) when the test is about how the route handles a refusal. Assertions about which plan caps at what belong in `ee/services/billing/planEnforcementService.test.ts`.
- Handlebars templates are the one exception: `@fastify/view` takes a single template root, so enterprise `.hbs` files stay under `src/templates` and are listed individually in the manifest.
- `src/services/limits/licenseBoundary.test.ts` fails the build if the manifest and the tree disagree; `src/services/limits/portability.test.ts` fails it if the core — production code or tests — reaches into `ee/`.

## Environment Variables

Copy `sample.env` to `.env` — it documents every variable. Required to boot:

- `MONGODB_URI` - MongoDB connection string
- `COOKIE_SECRET_SIGNATURE` - Cookie signing secret
- `API_KEY` - API authentication key
- `GH_PAT` - GitHub Personal Access Token for dispatch workflows
- `GITLAUNCH_ENV` - Optional. What environment this instance runs as (`prod`, `staging`). Instance-wide, not tied to a feature: it labels error reports and scopes our own feature flags. `GITLAUNCH_FLAG_ENV` is the older name and still works; falls back to `NODE_ENV`, then `development`. Resolved in `src/services/config/environmentName.ts`.
- `RELEASE` - Optional. Which build this is, so a report points at a known commit or tag.
- `SENTRY_DSN` - Optional. When set, the Sentry SDK is registered at boot (see `src/instrument.ts`, which must stay the first import in `src/index.ts`) and errors thrown while handling a request are reported, labelled with `GITLAUNCH_ENV` and `RELEASE`. `SENTRY_TRACES_SAMPLE_RATE` tunes tracing. Unset, reporting is a no-op and the SDK is never loaded.
- `ENCRYPTION_KEY` - 32-byte base64 key for encrypting stored secrets at rest (e.g. Jenkins API tokens); generate with `openssl rand -base64 32`. Boot fails closed if missing/invalid. For key rotation, use a keyring instead: `ENCRYPTION_KEYS="<id>:<base64key>,..."` plus `ENCRYPTION_PRIMARY_KEY_ID=<id>` (old keys stay for decryption; new writes use the primary).

GitHub App credentials (`GH_APP_ID`, `GH_APP_CLIENT_ID`, `GH_APP_CLIENT_SECRET`, `GH_APP_PRIVATE_KEY`, `GH_APP_NAME`, `GH_APP_WEBHOOK_SECRET`) are needed for real GitHub integration; set `USE_FAKE_GITHUB=true` to develop without them.

Optional, for keeping our own traffic out of analytics (unset = nothing is excluded):

- `ANALYTICS_INTERNAL_EMAILS` - comma-separated addresses (`me@x.dev`) or whole domains (`@x.dev`). A matching waitlist signup is still captured as a lead; its `waitlist_signup` event is stamped `internal: true` so acquisition reporting drops it.
- `ANALYTICS_INTERNAL_ACTORS` - comma-separated literal `distinctId`s (a `gl_vid` visitor cookie, a user ObjectId). Applied at query time, so it also excludes events already in the warehouse.

Optional, to also stream the same product events to PostHog (an additional destination, independent of `ANALYTICS_WAREHOUSE`):

- `POSTHOG_PROJECT_TOKEN` - enables the PostHog sink. Ignored on a self-hosted build: a customer's install must never report their usage to our project. The same token also loads the PostHog browser SDK in the page (`templates/partials/posthogSnippet.hbs`, rendered from the `<head>` of `layouts/main.hbs`), which is what produces session recordings, autocapture and client-side pageviews. It reaches the layout through `registerPlugins`' view defaults, so no route has to pass it.
- `POSTHOG_HOST` - where events are sent: the region the project lives in, or a reverse proxy on our own domain that forwards to it. Our instances use `https://t.gitlaunch.dev` (a PostHog managed proxy) so ingestion is first-party and ad blockers can't drop it; PostHog's UI still lives at `https://us.posthog.com`. Defaults to `https://us.i.posthog.com`. Used by both the server sink and the browser SDK.

Destinations are composed in `services/analytics/createAnalyticsService.ts`. Code that emits an event depends only on the `AnalyticsService` port, so a new destination is added there and nowhere else; `posthog-node` is imported by `createPostHogClient.ts` alone.

## TDD Development Mode

When implementing features, Claude MUST follow the Red-Green-Refactor cycle:

### TDD Workflow (MANDATORY)

**Before writing ANY production code:**

1. **RED Phase** - Write a failing test first

   - Create test file if it doesn't exist: `{filename}.test.ts`
   - Write test that describes the desired behavior
   - Run `yarn test` to confirm it fails
   - Commit: "test: [feature] - red"

2. **GREEN Phase** - Make it pass with minimal code

   - Write the simplest code that makes the test pass
   - No premature optimization or abstraction
   - Run `yarn test` to confirm it passes
   - Commit: "feat: [feature] - green"

3. **BLUE Phase** - Refactor if needed
   - Look for duplication, long methods, unclear names
   - Apply SOLID principles where appropriate
   - Run `yarn test` after each refactor step
   - Commit: "refactor: [feature] - blue"

### Test BEHAVIOR, Not Implementation

**CRITICAL**: Tests describe WHAT the system does, not HOW it does it.

**Good (Behavior):**

```typescript
it("should return the account when found by slug", async () => {
  // Given an account exists
  await repo.create({ name: "My Org", slug: "my-org" });

  // When I look it up by slug
  const result = await repo.findBySlug("my-org");

  // Then I get the account back
  expect(result?.name).toBe("My Org");
});
```

**Bad (Implementation):**

```typescript
it("should call collection.findOne with slug filter", async () => {
  // Testing HOW not WHAT - coupled to MongoDB internals
  await repo.findBySlug("my-org");
  expect(mockCollection.findOne).toHaveBeenCalledWith({ slug: "my-org" });
});
```

### Behavior Test Checklist

- [ ] Does this test describe a user-visible outcome?
- [ ] Would this test still pass if I refactored the internals?
- [ ] Am I testing the contract, not the collaboration?
- [ ] Can I explain this test without mentioning implementation?

### Signs of Implementation-Coupled Tests (AVOID)

- Mocking internal collaborators (use real collaborators or fakes)
- Asserting method call counts or arguments
- Testing private methods directly
- Tests that break when you refactor without changing behavior
- Tests that know about database schemas, HTTP details, etc.

### When Mocks ARE Appropriate

- External services (GitHub API, Stripe) - use contract-based fakes
- Time-dependent code - inject clock abstraction
- Random/non-deterministic behavior - inject seed or generator

### Test Naming Convention

```typescript
describe("ClassName", () => {
  describe("methodName", () => {
    it("should [expected behavior] when [condition]", () => {
      // Given - Arrange
      // When - Act
      // Then - Assert
    });
  });
});
```

### When NOT to write tests first

- Pure configuration files (e.g., tailwind.config.js)
- HTML templates (test via integration/e2e tests)
- Type definitions only (interfaces, types)

### SOLID Principles as Refactoring Rails

| Principle                 | When to Apply                                 |
| ------------------------- | --------------------------------------------- |
| **S**ingle Responsibility | Class doing too much? Extract                 |
| **O**pen/Closed           | Adding if/switch for types? Use polymorphism  |
| **L**iskov Substitution   | Subclass breaks parent contract? Redesign     |
| **I**nterface Segregation | Client using subset of interface? Split it    |
| **D**ependency Inversion  | Depending on concretions? Inject abstractions |
