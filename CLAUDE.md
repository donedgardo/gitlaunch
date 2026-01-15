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

LaunchPad is a SaaS deployment management tool built with:
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
- `GITHUB_PAT` - GitHub Personal Access Token for dispatch workflows
