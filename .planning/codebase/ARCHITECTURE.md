# Architecture

**Analysis Date:** 2026-02-07

## Pattern Overview

**Overall:** Layered MVC with dependency injection and service-oriented design.

**Key Characteristics:**

- Clear separation between HTTP layer, business logic, and data persistence
- Dependency injection pattern for all major components (repositories, services)
- Event-driven updates via SSE for real-time deployment status
- Multi-tenant architecture with account-based isolation
- HTMX integration for server-rendered interactive templates

## Layers

**Server/HTTP Layer:**

- Purpose: Handle HTTP requests, validate inputs, manage sessions, render templates
- Location: `src/server/`
- Contains: Route handlers (auth, builds, dashboard, services), middleware (session, API key auth), plugin configuration
- Depends on: Services, Repositories, Session service
- Used by: Client browsers and API consumers

**Service Layer:**

- Purpose: Implement business logic (build creation, deployment status tracking, dispatch coordination)
- Location: `src/services/`
- Contains: BuildService, BuildDispatchService, GitHubAppService, EnvironmentService, ApiKeyService, AuthService, StripeService
- Depends on: Repositories, external clients (GitHub, Stripe)
- Used by: Route handlers, other services

**Repository Layer:**

- Purpose: Abstract MongoDB operations with type-safe data access
- Location: `src/repositories/`
- Contains: AccountRepository, ServiceRepository, BuildRepository, UserRepository, MembershipRepository, etc.
- Depends on: MongoDB client, type definitions
- Used by: Services and routes for data persistence

**Authentication Layer:**

- Purpose: OAuth flows, session management, API key validation
- Location: `src/services/auth/`, `src/server/middleware/`
- Contains: SessionService, GitHubOAuthService, API key auth middleware
- Depends on: MongoDB, GitHub OAuth API
- Used by: All protected routes and services

## Data Flow

**Build Creation and Deployment Flow:**

1. User clicks "Deploy" button on dashboard (`/services/:serviceId/builds/:buildId/deploy/:env`)
2. Dashboard route handler (`src/server/dashboard/index.ts`) calls `buildService.updateDeploymentStatus()` with status `DISPATCHING`
3. BuildService validates the build, environment, and account ownership
4. BuildService triggers `buildDispatchService.dispatch()` to notify GitHub
5. BuildDispatchService queries account/service/repository to gather GitHub details
6. BuildDispatchService calls `githubDispatchService.dispatch()` to trigger GitHub Actions workflow
7. BuildService updates MongoDB with new deployment status
8. BuildService emits `build:update` event via EventEmitter
9. SSE endpoint (`/build-update-stream`) broadcasts update to connected clients
10. Dashboard updates deployment cell via HTMX swap

**Session/Authentication Flow:**

1. User visits `/auth/github` if unauthenticated
2. GitHubOAuthService redirects to GitHub OAuth consent screen
3. GitHub redirects back to `/auth/github/callback`
4. SessionService creates JWT token and stores in signed cookie
5. SessionMiddleware extracts token from cookie/header on each request
6. Token validated and attached to `request.session`
7. Session refreshed (sliding window) on each authenticated request

**State Management:**

- **Session State:** JWT token in signed HTTP-only cookie (7-day expiration, sliding window)
- **Deployment State:** Stored in MongoDB via `buildRepository.deployments` object (maps environment names to DeploymentStatus)
- **Real-time Updates:** EventEmitter broadcasts via SSE channel `/build-update-stream`
- **Event Types:** `build:created`, `build:update` (consumed by dashboard and setup pages)

## Key Abstractions

**BuildDispatchServiceI Interface:**

- Purpose: Abstract GitHub workflow dispatch implementation for testability
- Examples: `src/services/build/buildDispatchService.ts` (production), `NoOpBuildDispatchService` (testing)
- Pattern: Dependency injection via route configuration, allows mock implementation in tests

**DbClientI Interface:**

- Purpose: Abstract MongoDB client for health checks
- Location: `src/server/health/dbClientI.ts`
- Used by: Health check route to verify database connectivity

**Repository Pattern:**

- Purpose: Centralized MongoDB access with typed queries and mutations
- Examples: `AccountRepository`, `ServiceRepository`, `BuildRepository`
- Pattern: Each repository manages a single collection, provides type-safe methods like `findById()`, `create()`, `updateDeploymentStatus()`

**Service Layer Abstraction:**

- Purpose: Compose repositories and external clients into business operations
- Examples: BuildService coordinates BuildRepository, ServiceRepository, EventEmitter, and BuildDispatchService
- Pattern: Services handle validation, authorization, state mutations, and event emission

## Entry Points

**Server Start (`src/index.ts`):**

- Location: `src/index.ts`
- Triggers: Application startup (via `yarn start` or `yarn dev`)
- Responsibilities:
  - Load environment variables via dotenv
  - Create MongoDB connection and database reference
  - Initialize auth services (GitHub OAuth, session)
  - Initialize GitHub App client and service
  - Create and configure Fastify server via `createAppServer()`
  - Ensure database indexes on repositories
  - Start server on configured port (default 3050)

**Server Factory (`src/server/createAppServer.ts`):**

- Location: `src/server/createAppServer.ts`
- Triggers: Called from `src/index.ts` with dependencies
- Responsibilities:
  - Create Fastify instance
  - Register plugins (static files, views, cookies, SSE)
  - Create all repositories from database reference
  - Create all services with injected dependencies
  - Register session middleware
  - Register all route handlers (dashboard, build, auth, API, webhooks)
  - Return configured Fastify instance

**HTTP Routes (src/server/routes/ and src/server/\*/index.ts):**

- Dashboard: `src/server/dashboard/index.ts` - Service list, build table, deploy buttons
- Builds: `src/server/build/index.ts` - SSE stream endpoint for real-time updates
- Auth: `src/server/routes/auth/github.ts` - OAuth flow, user creation
- Services: `src/server/routes/services/index.ts` - Service CRUD, workflow configuration
- API: `src/server/routes/api/{builds,environments}.ts` - Programmatic API endpoints
- Webhooks: `src/server/routes/webhooks/stripe.ts` - Billing events

## Error Handling

**Strategy:** Synchronous error throwing for validation; async try-catch for operations.

**Patterns:**

- Validation errors: Throw `new Error(message)` synchronously in service constructors and request handlers
- Data not found: Return `null` from repository, check in service, throw or return error to client
- MongoDB errors: Catch in route handlers, return appropriate HTTP status (400/403/404/500)
- Transaction-like consistency: Leverage MongoDB's atomic `findOneAndUpdate()` for deployment status changes
- Error responses: API routes return JSON with `{ error: message }`, view routes re-render forms with error messages

**Recovery:**

- Failed deployments tracked via `DeploymentStatus.ERROR` state in MongoDB
- Explicit error messages guide user retry (e.g., "GitHub App not installed")
- No automatic retries - user-initiated redeploy

## Cross-Cutting Concerns

**Logging:** Console-based via `console.log()`, `console.info()`, `console.error()` (see `src/index.ts`, route handlers)

**Validation:**

- Input validation in route handlers (ObjectId format, required fields)
- Service-level validation (ownership, plan limits, environment existence)
- Repository-level validation (unique constraints via MongoDB indexes)

**Authentication:**

- Session middleware extracts and validates JWT from cookie/header
- API key middleware validates scopes before handler execution
- Routes redirect unauthenticated users to `/auth/github`

**Authorization:**

- Account ownership checks: Verify `service.accountId.equals(request.session.accountId)`
- Plan enforcement: PlanEnforcementService checks limits before creating services/repositories
- API key scopes: Middleware checks `requireScope("builds:write")` before mutation endpoints

**Rate Limiting:** Not implemented (no explicit limits detected)

**CORS:** Not required (server-rendered HTML, HTMX requests are same-origin)

---

_Architecture analysis: 2026-02-07_
