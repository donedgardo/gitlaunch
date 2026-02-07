# External Integrations

**Analysis Date:** 2026-02-07

## APIs & External Services

**GitHub:**

- GitHub OAuth - User authentication and authorization

  - SDK/Client: Custom `GitHubOAuthService` with `GitHubHttpClient`
  - Endpoints: `https://github.com/login/oauth/authorize`, `https://github.com/login/oauth/access_token`, `https://api.github.com/user`
  - Auth: `GH_APP_CLIENT_ID`, `GH_APP_CLIENT_SECRET` environment variables
  - Implementation: `src/services/auth/githubOAuthService.ts`

- GitHub App - Repository installation and management

  - SDK/Client: Custom `GitHubAppClient` with JWT-based authentication
  - Endpoints: `https://api.github.com/app/installations/{id}/access_tokens`, `https://api.github.com/repos/{owner}/{repo}/dispatches`
  - Auth: `GH_APP_ID`, `GH_APP_PRIVATE_KEY` (RS256 JWT signing)
  - Implementation: `src/services/github/githubAppClient.ts`
  - Token Service: `src/services/github/installationTokenService.ts` (caches and rotates installation tokens)

- GitHub Workflow Dispatch - Triggers CI/CD workflows
  - SDK/Client: Custom `MultiTenantGithubDispatchService`
  - Endpoint: POST `/repos/{owner}/{repo}/dispatches` (GitHub API v2022-11-28)
  - Payload: `event_type`, `client_payload` with `buildId`, `environment`, `serviceId`
  - Auth: Installation access token (obtained from GitHub App)
  - Implementation: `src/services/github/githubDispatchService.ts`

**Stripe (Optional):**

- Payment processing and subscription management
  - SDK: Stripe SDK (referenced but not directly imported; documentation in `src/services/billing/stripeSignatureVerifier.ts`)
  - Auth: `STRIPE_SECRET_KEY` environment variable (not in sample.env; optional integration)
  - Webhook Verification: `StripeWebhookSignatureVerifier` interface in `src/services/billing/stripeSignatureVerifier.ts`
  - Implementation: `src/services/billing/stripeService.ts` (checkout and billing portal URLs)

## Data Storage

**Databases:**

- MongoDB (Version 5.0+)
  - Connection: `MONGODB_URI` environment variable
  - Client: Native `mongodb` package (6.5.0)
  - Database name: `gitlaunch` (hardcoded in `src/index.ts`)
  - Collections: `accounts`, `users`, `memberships`, `repositories`, `services`, `builds`, `apiKeys`
  - Repositories: `src/repositories/` directory contains data access layer
    - `AccountRepository` - Account/organization management
    - `UserRepository` - User authentication and profile
    - `MembershipRepository` - Team membership and roles
    - `RepositoryRepository` - GitHub repositories
    - `ServiceRepository` - Deployed services
    - `BuildRepository` - Build history and logs
    - `ApiKeyRepository` - API key management

**File Storage:**

- Local filesystem only
  - Static assets: `src/public/` directory (CSS, JavaScript, images)
  - Templates: `src/templates/` directory (Handlebars `.hbs` files)
  - No cloud storage integration (S3, GCS, etc.)

**Caching:**

- In-memory caching via `Map` (GitHub installation tokens)
  - `InstallationTokenService` caches tokens with expiration tracking
  - TTL-based eviction: tokens expire after 1 hour from GitHub
  - No Redis or external cache

## Authentication & Identity

**Auth Provider:**

- GitHub OAuth 2.0 (user signup and login)

  - Endpoint: `/auth/github` route
  - Callback: `/auth/github/callback` route
  - Session: Cookie-based with `COOKIE_SECRET_SIGNATURE`
  - Implementation: `src/services/auth/githubOAuthService.ts`, `src/server/routes/auth/github.ts`

- Custom API Key Authentication

  - For programmatic API access
  - Implementation: `src/services/apiKey/apiKeyService.ts`
  - Middleware: `src/server/middleware/apiKeyAuth.ts`
  - Stored in MongoDB via `ApiKeyRepository`

- Session Management
  - Cookie-based sessions (signed with secret)
  - Implementation: `src/services/auth/sessionService.ts` (JWT-based session tokens)
  - Middleware: `src/server/middleware/sessionAuth.ts`
  - Secure cookie flag: Enabled in production (`NODE_ENV=production`)

## Monitoring & Observability

**Error Tracking:**

- None detected in codebase
- Errors logged to console via `console.error()`

**Logs:**

- Console logging only
  - Server startup: `console.info("Server listening on port...")`
  - Errors: `console.error()` in catch blocks
  - No structured logging framework (Winston, Pino, etc.)
  - No external log aggregation (CloudWatch, Datadog, etc.)

## CI/CD & Deployment

**Hosting:**

- AWS ECS (container definition file present: `aws-container-definition.json`)
- Docker container expected (build output in `dist/` directory)

**CI Pipeline:**

- None detected in repository
- GitHub Actions workflow dispatch supported (GitLaunch triggers these)
- E2E test configuration: `playwright.config.ts` with CI detection
  - CI mode: Parallel workers disabled, 2 retries enabled

## Environment Configuration

**Required Environment Variables:**
Core functionality requires:

- `MONGODB_URI` - MongoDB connection
- `PUBLIC_URL` - Application URL
- `COOKIE_SECRET_SIGNATURE` - Session cookie signing secret

GitHub integration requires:

- `GH_APP_ID` - GitHub App identifier
- `GH_APP_CLIENT_ID` - GitHub OAuth client ID
- `GH_APP_CLIENT_SECRET` - GitHub OAuth client secret
- `GH_APP_PRIVATE_KEY` - GitHub App private key (PEM format)
- `GH_APP_WEBHOOK_SECRET` - GitHub webhook signature verification (optional, if using webhooks)
- `GH_APP_NAME` - Display name for GitHub App

Optional (Stripe):

- `STRIPE_SECRET_KEY` - Stripe API key (if using billing)

**Secrets Location:**

- `.env` file in project root (not committed to git)
- Copy from `sample.env` and fill in values
- Private key injection: Use `scripts/add-private-key.sh` to inject `GH_APP_PRIVATE_KEY` from PEM file

## Webhooks & Callbacks

**Incoming:**

- GitHub OAuth callback: `/auth/github/callback` (Query params: `code`, `state`)
- GitHub App installation callback: `/github/installation/callback` (Query params: `installation_id`, `setup_action`)
- Stripe webhook: `POST /webhooks/stripe` (Header: `stripe-signature`)
  - Event types handled: `checkout.session.completed`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.payment_succeeded`
  - Implementation: `src/server/routes/webhooks/stripe.ts`, `src/services/billing/webhookHandler.ts`

**Outgoing:**

- GitHub Workflow Dispatch (via `MultiTenantGithubDispatchService`)
  - Endpoint: `POST /repos/{owner}/{repo}/dispatches`
  - Payload: Build ID, environment, service ID
  - Used by: `src/services/build/buildDispatchService.ts` when triggering deployments
- Real-time updates via Server-Sent Events
  - Endpoint: `GET /build-update-stream`
  - Uses: Fastify SSE plugin (`fastify-sse-v2`)
  - Implementation: `src/server/build/index.ts` (dashboard live updates)

## External APIs Used in Code

**API Version:**

- GitHub API v2022-11-28 (specified in Authorization headers)

**HTTP Client:**

- Native `fetch` API (Node.js 18+)
- Wrapped in `IHttpClient` interface for testability
- Implementations: `HttpClient` (production), `FakeHttpClient` (tests)
- No external HTTP library (axios, node-fetch, got) - uses built-in

---

_Integration audit: 2026-02-07_
