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

GitLaunch is a SaaS deployment management tool built with:

- **Fastify** - Web server framework
- **HTMX** - Client-side interactivity without a SPA
- **Handlebars** - Server-side templating
- **MongoDB** - Data persistence
- **Tailwind CSS** - Styling

### Core Structure

**Entry Point**: `src/index.ts` bootstraps the server with services and MongoDB connection.

**Server Layer** (`src/server/`):

- `index.ts` - Creates Fastify server and registers all route handlers
- `registerPlugins.ts` - Configures Fastify plugins (static files, views, cookies, OAuth2, SSE)
- Route handlers in subdirectories: `auth/`, `build/`, `dashboard/`, `health/`, `home/`

**Services Layer** (`src/services/`):

- `Service` class (`service/index.ts`) - Core business logic for managing deployments
- `BuildStorageI` interface - Abstraction for build data persistence
- `MongoBuildStorage` - MongoDB implementation of build storage
- `GithubDispatchService` - Triggers GitHub Actions workflows for deployments

### Key Patterns

**Dependency Injection**: Services are created via `createServices()` and injected into route handlers.

**Real-time Updates**: Uses Server-Sent Events (SSE) via `EventEmitter` to push deployment status updates to the dashboard (`/build-update-stream` endpoint).

**Environments**: Deployments track status across environments (staging, prod) defined in `Environments` enum.

**Deployment Status Flow**: `dispatching` -> `deploying` -> `deployed`/`error`/`cancelled`

### API Patterns

- UI routes use Handlebars templates with HTMX for partial updates
- API routes under `/api/{serviceName}/...` for programmatic access
- Both UI and API routes require authentication (user cookie or API key)

### Testing

- Unit tests: `*.test.ts` files alongside source files (excluded: `src/tests/`)
- E2E tests: `src/tests/` directory (requires running server)
- Mock implementations provided: `MockDispatchService`, `BuildMockStorage`, `MockAuthService`

## Environment Variables

Copy `sample.env` to `.env`. Required variables:

- `MONGODB_URI` - MongoDB connection string
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` - OAuth credentials
- `COOKIE_SECRET_SIGNATURE` - Cookie signing secret
- `API_KEY` - API authentication key
- `GH_PAT` - GitHub Personal Access Token for dispatch workflows
- `SENTRY_DSN` - Optional. When set, the Sentry SDK is registered at boot and errors thrown while handling a request are reported (`SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `SENTRY_TRACES_SAMPLE_RATE` tune it). Requires `yarn add @sentry/node`; unset, reporting is a no-op.
- `ENCRYPTION_KEY` - 32-byte base64 key for encrypting stored secrets at rest (e.g. Jenkins API tokens); generate with `openssl rand -base64 32`. Boot fails closed if missing/invalid. For key rotation, use a keyring instead: `ENCRYPTION_KEYS="<id>:<base64key>,..."` plus `ENCRYPTION_PRIMARY_KEY_ID=<id>` (old keys stay for decryption; new writes use the primary).

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
