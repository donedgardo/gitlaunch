# Suggested Commands

## Development

```bash
yarn install              # Install dependencies
yarn dev                  # Run server (hot-reload) + tailwind watcher
yarn build                # Build TypeScript to dist/ + compile Tailwind
yarn start                # Start production build from dist/
```

## Testing

```bash
yarn test                 # Run unit tests (watch mode disabled)
yarn test:watch           # Run unit tests in watch mode
yarn test:e2e             # Run E2E tests (requires server running)
yarn test:smoke           # Run smoke tests in src/tests/
```

## Database

```bash
yarn db:reset             # Reset database (scripts/reset-db.ts)
```

## Build Assets

```bash
yarn tailwind             # Build Tailwind CSS
yarn tailwind:watch       # Build Tailwind CSS in watch mode
```

## Git Hooks

- Husky automatically formats code on commit via prettier
- lint-staged runs: `prettier --write --ignore-unknown`
