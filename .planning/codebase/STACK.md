# Technology Stack

**Analysis Date:** 2026-02-07

## Languages

**Primary:**

- TypeScript 5.4.2 - Server and client-side code, type-safe development

**Secondary:**

- JavaScript - Handlebars templates (`.hbs`), Tailwind config
- Node.js built-in APIs - Event emitters, filesystem, crypto operations

## Runtime

**Environment:**

- Node.js (version not specified in `.nvmrc`; Fastify 4.26.2 requires Node.js 18+)

**Package Manager:**

- Yarn (inferred from `package.json` scripts and `yarn install`/`yarn dev` commands)
- Lockfile: Present (`yarn.lock` expected based on package.json structure)

## Frameworks

**Core:**

- Fastify 4.26.2 - Web server framework with plugin architecture
- Handlebars 4.7.8 - Server-side templating for HTML views
- HTMX - Client-side interactivity without SPA (referenced in templates, loaded via CDN)
- Tailwind CSS 3.4.1 - Utility-first CSS framework

**Testing:**

- Vitest 1.3.1 - Unit test runner and assertion library
- Playwright 1.57.0 - E2E browser automation testing
- Supertest 6.3.4 - HTTP assertion library for route testing
- MSW 2.12.7 - Mock Service Worker for API mocking

**Build/Dev:**

- TSX 4.7.1 - TypeScript executor for running `.ts` files directly
- Nodemon 3.1.0 - File watcher for dev server reload
- Concurrently 8.2.2 - Run multiple npm scripts in parallel (server + tailwind watch)
- TypeScript Compiler (tsc) - Compiles to `dist/` directory

## Key Dependencies

**Critical:**

- `mongodb` 6.5.0 - MongoDB driver for database operations
- `jsonwebtoken` 9.0.3 - JWT creation and verification (GitHub App authentication)
- `bcrypt` 6.0.0 - Password hashing for authentication
- `dotenv` 16.4.5 - Environment variable loading from `.env`

**Framework Plugins:**

- `@fastify/static` 7.0.1 - Static file serving (`/public` directory)
- `@fastify/view` 9.0.0 - Template rendering integration
- `@fastify/formbody` 7.4.0 - Form data parsing middleware
- `@fastify/cookie` 9.3.1 - Cookie parsing and signing
- `fastify-sse-v2` 4.0.0 - Server-Sent Events for real-time dashboard updates

**Development:**

- `mongodb-memory-server` 11.0.1 - In-memory MongoDB for testing
- `@vitest/coverage-v8` 1.3.1 - Code coverage reporting
- `prettier` 3.2.5 - Code formatting
- `husky` 9.0.11 - Git hooks
- `lint-staged` 15.2.2 - Run linters on staged files
- `cheerio` 1.0.0-rc.12 - HTML parsing for E2E tests
- `ncp` 2.0.0 - File copy utility for build postprocessing
- `fastify-tsconfig` 2.0.0 - Base TypeScript configuration for Fastify

## Configuration

**Environment Variables:**
All configuration via `.env` file (copy from `sample.env`):

- `PUBLIC_URL` - Server public URL (e.g., `http://localhost:3050`)
- `PORT` - Server port (default: 3050)
- `MONGODB_URI` - MongoDB connection string (e.g., `mongodb://localhost:27017`)
- `COOKIE_SECRET_SIGNATURE` - Secret for signing cookies
- `GH_APP_ID` - GitHub App ID
- `GH_APP_CLIENT_ID` - GitHub OAuth App client ID
- `GH_APP_CLIENT_SECRET` - GitHub OAuth App client secret
- `GH_APP_WEBHOOK_SECRET` - GitHub webhook signature verification
- `GH_APP_PRIVATE_KEY` - GitHub App private key (PEM format)
- `GH_APP_NAME` - Display name for GitHub App install URLs
- `NODE_ENV` - Environment mode (checked for production SSL/secure flags)

**Build Configuration:**

- `tsconfig.json` - TypeScript compiler options
  - Target: ES modules with `esModuleInterop`
  - Output: `./dist` directory
  - Base config: `fastify-tsconfig`
- `vitest.config.ts` - Test runner configuration
  - Excludes: `node_modules`, `dist`, `src/tests/` (E2E), `e2e/`
- `prettier.config` - Code formatter config
  - Tab width: 2 spaces
  - Semicolons: enabled
- `playwright.config.ts` - E2E test configuration
  - Browser: Chromium only
  - Test directory: `./e2e`
  - Server port: 3051 (to avoid dev server conflict)
  - Parallel: enabled except in CI
- `tailwind.config.js` - CSS utility framework
  - Content scan: `./src/**/*.hbs` (Handlebars templates only)

**Linting & Formatting:**

- `prettier` for code formatting
- `lint-staged` for pre-commit hooks (run prettier on staged files)
- `husky` for git hook setup

## Platform Requirements

**Development:**

- Node.js 18+ (required by Fastify 4.26.2)
- MongoDB local instance or connection string
- Yarn package manager
- Git (for husky hooks)

**Production:**

- Node.js 18+ runtime
- MongoDB database (version 5.0+)
- Environment variables configured
- Port accessibility (default: 3050)
- HTTPS support recommended (Fastify native HTTP only; use reverse proxy)

**Deployment:**

- AWS ECS container definition file exists: `aws-container-definition.json`
- Build output: `dist/` directory contains compiled code and static assets
- Post-build steps: Copies `src/templates/` to `dist/templates/` and `src/public/` to `dist/public/`

---

_Stack analysis: 2026-02-07_
