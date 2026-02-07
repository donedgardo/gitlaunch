# Codebase Structure

**Analysis Date:** 2026-02-07

## Directory Layout

```
launchpad/
├── src/
│   ├── index.ts                    # Entry point: Bootstrap server, create services
│   ├── server/
│   │   ├── createAppServer.ts      # Fastify factory: Create server and register routes
│   │   ├── registerPlugins.ts      # Configure Fastify plugins (views, static, SSE, cookies)
│   │   ├── registerHandlebarsHelpers.ts  # Custom Handlebars template helpers
│   │   ├── middleware/
│   │   │   ├── sessionAuth.ts      # Session validation and extraction
│   │   │   └── apiKeyAuth.ts       # API key validation and scope checking
│   │   ├── health/
│   │   │   ├── index.ts            # Health check route (/health)
│   │   │   └── dbClientI.ts        # Database client interface
│   │   ├── dashboard/
│   │   │   └── index.ts            # Dashboard routes (service list, build table, deploy)
│   │   ├── build/
│   │   │   └── index.ts            # Build routes (SSE stream endpoint)
│   │   ├── home/
│   │   │   └── index.ts            # Home/landing page route
│   │   ├── testing/
│   │   │   └── mockViewPlugin.ts   # Mock Handlebars for testing
│   │   └── routes/
│   │       ├── auth/
│   │       │   └── github.ts       # GitHub OAuth flow routes
│   │       ├── github/
│   │       │   └── installation.ts # GitHub App installation webhook
│   │       ├── onboarding/
│   │       │   └── index.ts        # Account/repo setup onboarding
│   │       ├── services/
│   │       │   ├── index.ts        # Service CRUD (create, list, configure workflow)
│   │       │   └── settings.ts     # Environment management routes
│   │       ├── api/
│   │       │   ├── builds.ts       # API v1: Build CRUD endpoints
│   │       │   └── environments.ts # API v1: Environment endpoints
│   │       └── webhooks/
│   │           └── stripe.ts       # Stripe billing webhooks
│   ├── services/
│   │   ├── build/
│   │   │   ├── buildService.ts     # Business logic: Create builds, update status
│   │   │   ├── buildDispatchService.ts  # Coordinate GitHub dispatch
│   │   │   └── buildDispatchService.test.ts
│   │   ├── github/
│   │   │   ├── githubAppService.ts # GitHub App authentication, workflow listing
│   │   │   ├── githubAppClient.ts  # GitHub App JWT generation
│   │   │   ├── githubApiClient.ts  # GitHub REST API client
│   │   │   ├── installationTokenService.ts  # Token management
│   │   │   ├── githubDispatchService.ts    # Trigger GitHub Actions workflows
│   │   │   └── [*.test.ts]         # Unit tests
│   │   ├── auth/
│   │   │   ├── sessionService.ts   # JWT session creation/validation
│   │   │   ├── githubOAuthService.ts  # GitHub OAuth consent flow
│   │   │   ├── mongoDbClient.ts    # MongoDB connection wrapper
│   │   │   └── [*.test.ts]
│   │   ├── apiKey/
│   │   │   ├── apiKeyService.ts    # Generate and validate API keys
│   │   │   └── apiKeyService.test.ts
│   │   ├── environment/
│   │   │   ├── environmentService.ts  # Manage service environments
│   │   │   └── environmentService.test.ts
│   │   ├── billing/
│   │   │   ├── stripeService.ts    # Stripe payment integration
│   │   │   ├── planEnforcementService.ts  # Check plan limits
│   │   │   ├── stripeSignatureVerifier.ts # Webhook validation
│   │   │   ├── webhookHandler.ts   # Stripe event processing
│   │   │   └── [*.test.ts]
│   │   ├── account/
│   │   │   └── [types/implementations]
│   │   ├── service/
│   │   │   ├── deploymentStatus.ts # Enum: Deployment status values
│   │   │   └── deploymentLogsRecord.ts  # Type: Deployment log record
│   │   ├── repository/
│   │   │   └── [types/implementations]
│   │   ├── invitation/
│   │   │   └── [types/implementations]
│   │   └── [*.test.ts]
│   ├── repositories/
│   │   ├── accountRepository.ts     # Account data access (plan, GitHub install)
│   │   ├── userRepository.ts        # User data access (identity, auth)
│   │   ├── serviceRepository.ts     # Service data access (deployments, environments)
│   │   ├── buildRepository.ts       # Build data access (deployment status, logs)
│   │   ├── repositoryRepository.ts  # GitHub repository metadata
│   │   ├── membershipRepository.ts  # Account membership (multi-user)
│   │   ├── invitationRepository.ts  # Account invitations
│   │   ├── apiKeyRepository.ts      # API key storage
│   │   └── [*.test.ts]
│   ├── templates/
│   │   ├── index.hbs               # Dashboard main page (service nav, build table)
│   │   ├── dashboard.hbs           # Dashboard layout wrapper
│   │   ├── deploymentStatus.hbs    # Single deployment status display
│   │   ├── layouts/
│   │   │   └── main.hbs            # Main layout (header, nav, footer)
│   │   ├── partials/
│   │   │   ├── htmxDashboard.hbs   # HTMX partial for dashboard content swap
│   │   │   ├── buildTable.hbs      # Build table with rows
│   │   │   ├── buildRow.hbs        # Single build row
│   │   │   ├── buildEnvironmentAction.hbs  # Deploy button/status cell
│   │   │   ├── environmentList.hbs # Environment selector
│   │   │   ├── navigation.hbs      # Service navigation sidebar
│   │   │   ├── deploymentSetupGuide.hbs   # GitHub workflow setup guide
│   │   │   ├── emptyBuilds.hbs     # Empty state when no builds
│   │   │   └── [*.hbs]
│   │   ├── onboarding/
│   │   │   ├── index.hbs
│   │   │   └── [*.hbs]
│   │   ├── services/
│   │   │   ├── new.hbs             # Create service form
│   │   │   ├── created.hbs         # API key display after creation
│   │   │   └── [*.hbs]
│   │   └── [*.hbs]
│   ├── public/
│   │   ├── js/
│   │   │   └── [client scripts]    # HTMX interactions, form handling
│   │   └── css/
│   │       └── [styles]
│   ├── styles/
│   │   └── [Tailwind CSS files]
│   ├── repositories.ts             # [Legacy or aggregate file]
│   ├── userService/
│   │   └── userRecord.ts           # User type definition
│   └── tests/
│       ├── config.ts               # Test configuration (URLs, environment)
│       └── [e2e and integration tests]
├── e2e/
│   ├── mocks/
│   │   └── [Mock implementations for testing]
│   └── helpers/
│       └── [E2E test utilities]
├── scripts/
│   └── [Build and utility scripts]
├── dist/                           # TypeScript compiled output
├── coverage/                       # Test coverage reports
├── .env                            # [Not tracked] Environment configuration
├── sample.env                      # Environment variable template
├── package.json                    # Dependencies, build scripts
├── tsconfig.json                   # TypeScript configuration
├── vitest.config.ts                # Test runner configuration
└── CLAUDE.md                       # Development guidelines
```

## Directory Purposes

**`src/index.ts`:**

- Purpose: Application bootstrap
- Loads environment variables, connects to MongoDB, initializes services, starts server
- Single responsibility: Dependency assembly and server startup

**`src/server/`:**

- Purpose: HTTP request handling layer
- Contains all Fastify route handlers, middleware, plugins, and template configuration
- Routes organized by feature (auth, services, builds, dashboard, webhooks)
- Each route registration file exports a factory function taking dependencies

**`src/services/`:**

- Purpose: Business logic and external service integration
- Each subdirectory handles one domain: build management, GitHub integration, billing, auth, API keys
- Services encapsulate queries from repositories and coordinate operations
- Services are stateless, receive all dependencies via constructor injection

**`src/repositories/`:**

- Purpose: Data persistence abstraction
- One repository per MongoDB collection
- Provides type-safe queries (`findById`, `findByAccountId`, etc.) and mutations (`create`, `updateDeploymentStatus`)
- Handles MongoDB indexes and validation (unique constraints)

**`src/templates/`:**

- Purpose: Server-side HTML rendering with Handlebars
- Partials for reusable components (build table row, deploy button, navigation)
- Layouts for consistent page structure
- HTMX directives trigger dynamic updates without page reloads

**`src/public/`:**

- Purpose: Static assets (JavaScript, CSS)
- CSS: Tailwind pre-compiled or processed
- JavaScript: Client-side HTMX event handlers and form interactions

## Key File Locations

**Entry Points:**

- `src/index.ts`: Application startup (bootstrap, service creation)
- `src/server/createAppServer.ts`: Fastify factory (route registration, middleware setup)
- `src/server/routes/auth/github.ts`: OAuth flow entry point

**Configuration:**

- `package.json`: Dependencies, scripts (dev, build, test, start)
- `tsconfig.json`: TypeScript compiler options
- `vitest.config.ts`: Test runner configuration, globals, coverage
- `sample.env`: Template for required environment variables (copy to `.env`)

**Core Logic:**

- `src/services/build/buildService.ts`: Build creation, deployment status updates
- `src/services/build/buildDispatchService.ts`: GitHub workflow dispatch coordination
- `src/repositories/buildRepository.ts`: Build data persistence and deployment tracking
- `src/repositories/serviceRepository.ts`: Service configuration and environments

**Testing:**

- `src/**/*.test.ts`: Unit tests colocated with implementation
- `e2e/`: End-to-end tests (require running server)
- `src/tests/config.ts`: Test environment configuration

**Data Models:**

- `src/repositories/*.ts`: Type definitions for Account, Service, Build, Repository, User, etc.
- `src/services/service/deploymentStatus.ts`: Enum for build status states

## Naming Conventions

**Files:**

- `*Repository.ts`: Data access objects (e.g., `buildRepository.ts`, `accountRepository.ts`)
- `*Service.ts`: Business logic services (e.g., `buildService.ts`, `githubAppService.ts`)
- `*.test.ts`: Unit tests colocated with implementation
- `index.ts`: Module entry point (route factory, plugin registration)
- `*.hbs`: Handlebars template files

**Directories:**

- Lowercase with camelCase: `src/services/build`, `src/server/routes/api`
- Feature-based organization: `services/github/`, `routes/services/`, `routes/api/`
- No index files in directories except as entry points

**Functions:**

- `create*`: Constructor/creation functions (e.g., `createAppServer`, `createBuildInput`)
- `register*`: Fastify plugin/route registration (e.g., `registerPlugins`, `registerServiceRoutes`)
- `find*`: Repository query functions (e.g., `findById`, `findByAccountId`)
- `update*`: Repository mutation functions (e.g., `updateDeploymentStatus`)
- camelCase for all functions

**Types:**

- `{Feature}Type`: Type definitions (e.g., `BuildType` or just `Build` for collections)
- `{Feature}Input`: Constructor input types (e.g., `CreateBuildInput`)
- `{Feature}Dependencies` or `{Feature}Deps`: Dependency injection objects (e.g., `ServiceRoutesDeps`)
- PascalCase for all types

**Classes:**

- PascalCase (e.g., `BuildRepository`, `BuildService`)

**Constants:**

- UPPER_CASE for enum values and constants (e.g., `DeploymentStatus.DISPATCHING`)

## Where to Add New Code

**New Feature (e.g., new deployment status update):**

1. **Business logic**: `src/services/build/buildService.ts` - Add method to existing BuildService
2. **Data access**: `src/repositories/buildRepository.ts` - Add query/mutation if needed
3. **Route handler**: `src/server/routes/api/builds.ts` or `src/server/dashboard/index.ts`
4. **Tests**: Create `buildService.test.ts` alongside implementation (if doesn't exist)

**New Service (e.g., notification service):**

1. Create directory: `src/services/notifications/`
2. Create service file: `src/services/notifications/notificationService.ts`
3. Create test file: `src/services/notifications/notificationService.test.ts`
4. Inject into `src/server/createAppServer.ts` in the "Services" section
5. Pass to relevant route handlers that need notifications

**New External Integration (e.g., Slack):**

1. Create directory: `src/services/slack/`
2. Create client wrapper: `src/services/slack/slackClient.ts` (abstracts SDK)
3. Create service: `src/services/slack/slackService.ts` (business logic)
4. Create tests: `src/services/slack/slackService.test.ts`
5. Initialize client in `src/index.ts` with environment variables
6. Inject into `src/server/createAppServer.ts`

**New Repository (e.g., notification log storage):**

1. Create: `src/repositories/notificationLogRepository.ts`
2. Define type: `export type NotificationLog = { ... }`
3. Implement CRUD methods following existing patterns
4. Initialize in `src/server/createAppServer.ts`
5. Inject into services that need it

**New Route (e.g., notification preferences):**

1. Create directory: `src/server/routes/notifications/` or add to existing `src/server/routes/settings/`
2. Create file: `src/server/routes/notifications/index.ts`
3. Export registration function: `export function registerNotificationRoutes(app, deps)`
4. Call from `src/server/createAppServer.ts` after other route registrations
5. Create template files in `src/templates/notifications/` if needed

**New API Endpoint (e.g., notification status):**

1. Add route to `src/server/routes/api/notifications.ts` (create if doesn't exist)
2. Follow pattern in `src/server/routes/api/builds.ts` (typed params/body, scope checking)
3. Register in `src/server/createAppServer.ts` inside the `/api/v1` prefix group
4. Add tests to `src/server/routes/api/notifications.test.ts`

**New Template (e.g., notification page):**

1. Create `.hbs` file in `src/templates/notifications/`
2. If reusable component, create partial in `src/templates/partials/notificationCard.hbs`
3. Register partial path in `src/server/registerPlugins.ts` options
4. Use in route handler with `reply.view('notifications/index', data, { layout: '/layouts/main.hbs' })`

**UI Component (form, table, button):**

1. If template-based: Create partial in `src/templates/partials/`
2. Use in parent template with `{{> partialName prop=value}}`
3. If HTMX-enabled: Add HTMX directives (hx-post, hx-swap, hx-trigger)
4. If client JS needed: Add to `src/public/js/` with document event listeners

## Special Directories

**`src/tests/`:**

- Purpose: E2E and integration test configuration
- Generated: No
- Committed: Yes
- Contains: Global test setup, Playwright configuration, test utilities

**`e2e/`:**

- Purpose: End-to-end tests using Playwright
- Generated: No
- Committed: Yes
- Contains: Mocks for GitHub API, test helpers, browser automation tests

**`dist/`:**

- Purpose: Compiled TypeScript output
- Generated: Yes (from `yarn build`)
- Committed: No
- Contains: JavaScript files compiled from `src/` TypeScript

**`coverage/`:**

- Purpose: Test coverage reports
- Generated: Yes (from `yarn test` with coverage flag)
- Committed: No
- Contains: HTML coverage reports and coverage JSON

**`node_modules/`:**

- Purpose: Installed npm dependencies
- Generated: Yes (from `yarn install`)
- Committed: No

---

_Structure analysis: 2026-02-07_
