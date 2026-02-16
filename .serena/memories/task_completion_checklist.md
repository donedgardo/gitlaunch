# Task Completion Checklist

When completing a task, ensure:

## 1. TDD Cycle Completed

- [ ] RED: Failing test written and committed
- [ ] GREEN: Minimal code to pass, committed
- [ ] BLUE: Refactored if needed, committed

## 2. Tests Pass

```bash
yarn test                 # All unit tests pass
yarn test:e2e             # All E2E tests pass (if applicable)
```

## 3. Build Succeeds

```bash
yarn build                # TypeScript compiles without errors
```

## 4. Code Formatted

- Automatic via git commit hooks (husky + lint-staged)
- Manual check: `prettier --write --ignore-unknown .`

## 5. Environment Variables

- If new env vars added, update `sample.env`
- Document in CLAUDE.md under Environment Variables

## 6. Templates & Assets

- If templates changed, verify `yarn build` copies them (`postbuild` script)
- If styles changed, verify `yarn tailwind` generates CSS

## 7. Git Commits

Follow conventional commits:

- `test: [feature] - red` (failing test)
- `feat: [feature] - green` (implementation)
- `refactor: [feature] - blue` (refactoring)
- `docs: [description]` (documentation)
- `fix: [description]` (bug fixes)

## 8. No Skipped Tests

- No tests marked as "only" or "skip"
- All tests should run in CI
