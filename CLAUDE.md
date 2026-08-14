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

### Testing

- Unit tests: `*.test.ts` alongside the source file
- Smoke tests: `src/tests/` (`yarn test:smoke`)
- E2E: `e2e/` with Playwright (`yarn test:e2e`, requires a running server)
- Use the existing fakes rather than mocking internals: `FakeGitHubAppClient`, `FakeGitHubApiClient`, `FakeHttpClient`, `FakeStripeClient`, `FakeFlags`

`github-action` is a git submodule; run `git submodule update --init` in a fresh clone or worktree or the reporter contract test fails.

### Licensing boundary

This repo is open core. Everything is FSL-1.1-ALv2 (`LICENSE.md`) **except** the paths listed in `ENTERPRISE-PATHS.md`, which are commercial (`LICENSE-enterprise.md`). The line is one account and one seat: multi-seat, SSO, billing and license issuance are sold; deployment tracking, flags, analytics and the API are not.

When you add code:

- Building a seat/SSO/billing/licensing feature? Add its path to `ENTERPRISE-PATHS.md` under **Covered paths** and put `// GitLaunch Enterprise Feature — licensed under LICENSE-enterprise.md, not the FSL.` at the top of each file (`{{!-- … --}}` in `.hbs`).
- Anything else defaults to FSL. Don't add paths to the manifest to be safe — a wrong claim of coverage is worse than none.
- `src/services/licensing/licenseBoundary.test.ts` fails the build if the manifest and the tree disagree.

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
