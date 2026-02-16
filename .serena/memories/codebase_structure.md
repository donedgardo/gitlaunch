# Codebase Structure

## Root Structure

```
/home/donedgardo/.openclaw/workspace/launchpad/
├── src/                    # Source code
├── dist/                   # Compiled output (build artifacts)
├── scripts/                # Utility scripts (e.g., reset-db.ts)
├── e2e/                    # E2E test files
├── .planning/              # Phase planning documentation
├── .claude/                # Claude Code agent configurations
├── .github/                # GitHub Actions workflows
├── docs/                   # Documentation
├── CLAUDE.md               # Development guide for Claude Code
├── package.json            # Dependencies and scripts
├── tsconfig.json           # TypeScript configuration
├── vitest.config.ts        # Unit test configuration
├── playwright.config.ts    # E2E test configuration
├── tailwind.config.js      # Tailwind CSS configuration
└── .env                    # Environment variables (not committed)
```

## Source Structure (`src/`)

```
src/
├── index.ts                # Entry point - bootstraps server
├── server/                 # Fastify server and routes
│   ├── index.ts            # Creates server, registers routes
│   ├── registerPlugins.ts  # Fastify plugins (static, views, OAuth, SSE)
│   ├── auth/               # Authentication routes
│   ├── build/              # Build/deployment routes
│   ├── dashboard/          # Dashboard routes
│   ├── health/             # Health check routes
│   └── home/               # Landing page routes
├── services/               # Business logic layer
│   ├── service/            # Core deployment service
│   ├── storage/            # Data persistence interfaces + implementations
│   └── github/             # GitHub integration
├── templates/              # Handlebars templates (.hbs files)
├── public/                 # Static assets (CSS, images)
├── styles/                 # Tailwind input CSS
└── tests/                  # E2E tests
```

## Key Patterns

- **Dependency Injection**: Services created via `createServices()`, injected into routes
- **Interface-first**: Abstract interfaces (e.g., `BuildStorageI`), concrete implementations (e.g., `MongoBuildStorage`)
- **Real-time Updates**: Server-Sent Events via EventEmitter for build status
- **Route organization**: UI routes (Handlebars), API routes under `/api/{serviceName}/...`
