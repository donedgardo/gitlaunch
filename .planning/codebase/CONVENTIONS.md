# Coding Conventions

**Analysis Date:** 2026-02-07

## Naming Patterns

**Files:**

- Services: `{serviceName}Service.ts` (e.g., `buildService.ts`, `sessionService.ts`)
- Repositories: `{entityName}Repository.ts` (e.g., `accountRepository.ts`, `buildRepository.ts`)
- Route handlers: `index.ts` in feature directories (e.g., `src/server/routes/api/builds.ts`)
- Test files: `{fileName}.test.ts` (co-located with source)
- Middleware: `{middlewareName}.ts` in `src/server/middleware/` (e.g., `apiKeyAuth.ts`)
- Constants/enums: PascalCase with SCREAMING_SNAKE_CASE values (e.g., `Plan.Free`, `Plan.Paid`)

**Functions:**

- camelCase for all functions and methods
- Boolean-returning functions use `is`, `has`, `can` prefixes (e.g., `hasInstallation()`, `canDeploy()`)
- Async functions named descriptively (e.g., `createCheckoutSession()`, `updateDeploymentStatus()`)
- Event emitter methods use `on()` and `emit()` patterns

**Variables:**

- camelCase for local and module-level variables
- Readonly/constant collections use `SCREAMING_SNAKE_CASE` (e.g., `FREE_PLAN_LIMITS`)
- Private class fields prefixed with underscore: `private fieldName`
- Input/parameter objects use explicit types (e.g., `CreateBuildInput`, `UpdateDeploymentStatusBody`)

**Types:**

- Interface names: PascalCase with leading `I` for interfaces (e.g., `StripeClient`, `IHttpClient`)
- Type aliases: PascalCase for objects and unions
- Discriminated unions follow object pattern (e.g., `DeploymentStatus.DEPLOYED`)
- Generic type parameters: Single letter or descriptive (e.g., `T`, `Collection<Account>`)
- Input/Request body types: `{Action}{Domain}Input` or `{Action}{Domain}Body` (e.g., `CreateBuildInput`, `UpdateDeploymentStatusBody`)

**Classes:**

- PascalCase class names
- Dependency injection via constructor parameters (typed)
- Private methods use underscore prefix for clarity

## Code Style

**Formatting:**

- Prettier v3.2.5 configured
- Tab width: 2 spaces
- Semicolons: required
- Line length: no enforced limit in config

**Linting:**

- lint-staged runs Prettier on staged files
- No explicit ESLint config found - relies on TypeScript strict mode

**TypeScript:**

- `noImplicitAny: true` enforced (all types must be explicit)
- `strict` mode configured via `fastify-tsconfig`
- Type annotations required on function parameters and returns

## Import Organization

**Order:**

1. Node.js built-ins (e.g., `import EventEmitter from "node:events"`)
2. Third-party packages (e.g., `import { MongoClient } from "mongodb"`)
3. Internal application code (e.g., `import { BuildRepository } from "../../repositories/..."`)
4. Type imports follow same order with explicit `type` keyword when needed

**Path Aliases:**

- No path aliases configured
- Use relative paths with consistent depth (e.g., `../../repositories/accountRepository`)

**Barrel Files:**

- Not used in this codebase
- Import directly from individual files

## Error Handling

**Patterns:**

- Throw `Error` instances with descriptive messages (e.g., `throw new Error("Service not found")`)
- Error messages are lowercase, descriptive, and specific (e.g., "Account with slug 'my-org' already exists")
- No custom error classes - standard `Error` throughout
- Validation errors thrown immediately before operations
- Errors propagate up the call stack to be handled by route handlers or tests
- Console logging for startup errors only: `console.error()` and `console.info()`

**Validation Strategy:**

- Validate inputs at the boundary (service/repository methods)
- Check preconditions early in functions (e.g., service existence, authorization)
- Return `null` for not-found cases (versus throwing) - documented via return type `T | null`

**Async Error Handling:**

- Use `.catch()` patterns for top-level startup (e.g., `start().catch(err => ...)`)
- Tests use `expect().rejects.toThrow()` pattern
- No try/catch blocks in non-test code

## Logging

**Framework:** console (built-in)

**Patterns:**

- `console.info()` for startup/informational messages
- `console.error()` for error conditions
- No debug or trace logging
- No structured logging framework in use
- Logging is minimal - only for lifecycle events, not business logic

**When to Log:**

- Server startup: `console.info(\`Server listening on port ${PORT}\`)`
- Fatal errors: `console.error("Failed to start server:", err)`
- Not logged: function entry/exit, intermediate state changes, HTTP requests

## Comments

**When to Comment:**

- Explain _why_, not _what_ the code does (let code speak for itself)
- Document non-obvious algorithms or business rules
- Explain rationale behind design choices in comments before the code block

**Examples:**

```typescript
// Use existing customer if available, otherwise use email if provided
// If no email, Stripe checkout will prompt the user for it
if (params.account.stripeCustomerId) {
  checkoutParams.customerId = params.account.stripeCustomerId;
} else if (params.userEmail) {
  checkoutParams.customerEmail = params.userEmail;
}

// Emit event for SSE updates (used by setup page to detect first build)
this.eventEmitter.emit("build:created", { ... });

// Auto-mark workflow as configured if not already
if (!service.workflowConfigured) {
  await this.serviceRepo.markWorkflowConfigured(input.serviceId);
}
```

**JSDoc/TSDoc:**

- Not used - TypeScript types provide sufficient documentation
- No `@param`, `@returns`, or `@throws` annotations

## Function Design

**Size:**

- Keep functions focused on single responsibility
- Services typically 5-50 lines per method
- Repositories 5-20 lines per method
- Never more than 100 lines without refactoring consideration

**Parameters:**

- Prefer object parameters for 2+ arguments (destructured in function signature)
- Example: `async createBuild(input: CreateBuildInput): Promise<Build>`
- Functions accepting 1 simple parameter use direct type (e.g., `findById(id: ObjectId)`)

**Return Values:**

- Explicit return type annotations required on all functions
- Async functions return `Promise<T>`
- Repository methods return `T | null` for lookups, `T[]` for lists, `T` for mutations
- Service methods return domain objects or void
- Emit events via EventEmitter for side effects (not return values)

**Dependency Injection:**

- All external dependencies passed via constructor
- Dependencies are interface types for testability
- Example: `constructor(private buildRepo: BuildRepository, private eventEmitter: EventEmitter)`

## Module Design

**Exports:**

- Named exports (not default exports)
- Export interfaces before implementations
- Export type aliases used by consumers

**Example Pattern:**

```typescript
// Interfaces and types first
export interface StripeClient { ... }
export type StripeServiceConfig = { ... }

// Then implementation
export class StripeService { ... }
```

**Service Structure:**

- Service classes have single constructor with all dependencies
- Public async methods represent business operations
- Private methods for internal helpers
- No static methods - instantiate and inject
- Services emit events via injected EventEmitter

**Repository Structure:**

- Single collection per repository class
- Public methods for CRUD and queries
- Private collection property
- Methods are async (even if not database async)
- Return domain types, never raw MongoDB documents

---

_Convention analysis: 2026-02-07_
