# Code Style & Conventions

## TDD Workflow (MANDATORY)

All feature development follows Red-Green-Refactor:

1. **RED**: Write failing test first → `yarn test` → commit "test: [feature] - red"
2. **GREEN**: Minimal code to pass → `yarn test` → commit "feat: [feature] - green"
3. **BLUE**: Refactor if needed → `yarn test` → commit "refactor: [feature] - blue"

## Test Philosophy

- **Test BEHAVIOR, not implementation**
- Tests describe WHAT the system does, not HOW
- Use Given-When-Then structure
- Avoid mocking internal collaborators
- Mock only external services (GitHub, Stripe, time)

## Test Naming Convention

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

## Test Location

- Unit tests: `*.test.ts` alongside source files (except `src/tests/`)
- E2E tests: `src/tests/` directory

## SOLID Principles

Applied during refactoring (BLUE phase):

- **S**ingle Responsibility: Class doing too much? Extract
- **O**pen/Closed: Adding if/switch for types? Use polymorphism
- **L**iskov Substitution: Subclass breaks parent contract? Redesign
- **I**nterface Segregation: Client using subset? Split interface
- **D**ependency Inversion: Depending on concretions? Inject abstractions

## Formatting

- Prettier for code formatting (via lint-staged on commit)
- Auto-formatted on git commit via husky hooks
