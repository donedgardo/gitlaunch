# Testing Patterns

**Analysis Date:** 2026-02-07

## Test Framework

**Runner:**

- Vitest v1.3.1
- Config: `vitest.config.ts`
- Excludes: `node_modules/`, `dist/`, `src/tests/**` (reserved for smoke/e2e)

**Assertion Library:**

- Vitest built-in matchers (expect API)
- No external assertion library

**Run Commands:**

```bash
yarn test                # Run all unit tests in watch mode, then exit
yarn test:watch          # Run tests in watch mode (re-run on file change)
yarn test:e2e            # Run E2E tests with Playwright
yarn test:smoke          # Run smoke/integration tests from src/tests/
yarn build               # Compile TypeScript before deployment
```

## Test File Organization

**Location:**

- Co-located with source files (same directory)
- Pattern: `{fileName}.test.ts` next to `{fileName}.ts`
- Examples:
  - Source: `src/services/build/buildService.ts`
  - Test: `src/services/build/buildService.test.ts`
  - Source: `src/repositories/accountRepository.ts`
  - Test: `src/repositories/accountRepository.test.ts`

**Special Test Directories:**

- `src/tests/` - Integration/smoke tests that require running server
- `e2e/` - Playwright end-to-end tests (not visible in provided codebase)

**Structure:**

```
src/
├── services/
│   ├── build/
│   │   ├── buildService.ts
│   │   └── buildService.test.ts      # Unit tests
│   └── auth/
│       ├── sessionService.ts
│       └── sessionService.test.ts
├── repositories/
│   ├── accountRepository.ts
│   └── accountRepository.test.ts
├── server/
│   ├── middleware/
│   │   ├── apiKeyAuth.ts
│   │   └── apiKeyAuth.test.ts
│   └── routes/
│       └── api/
│           ├── builds.ts
│           └── builds.test.ts
└── tests/                             # Integration tests
    ├── smoke.test.ts
    └── publicEndpoint.test.ts
```

## Test Structure

**Suite Organization:**

```typescript
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";

describe("BuildService", () => {
  // Setup fixtures at suite level
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let service: BuildService;

  beforeAll(async () => {
    // One-time setup - start MongoDB in-memory server
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
  });

  afterAll(async () => {
    // One-time cleanup
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    // Before each test - clean database
    await db.collection("builds").deleteMany({});
    vi.clearAllMocks();
  });

  describe("methodName", () => {
    it("should [expected behavior] when [condition]", async () => {
      // Given: arrange test data
      const account = await accountRepo.create({
        name: "My Org",
        slug: "my-org",
      });

      // When: perform action
      const build = await service.createBuild({
        accountId: account._id,
        serviceId: svc._id,
        buildId: "abc123",
      });

      // Then: assert outcomes
      expect(build._id).toBeDefined();
      expect(build.buildId).toBe("abc123");
    });
  });
});
```

**Key Patterns:**

- Use "Given/When/Then" comments for test readability
- Nested `describe()` blocks organize by method/feature
- `beforeAll/afterAll` for database server lifecycle
- `beforeEach` for data cleanup and mock reset
- Async operations properly awaited
- One assertion focus per test (multiple assertions for related concerns)

## Mocking

**Framework:**

- Vitest `vi` utilities for mocking
- `vi.fn()` for function mocks
- `vi.useFakeTimers()` and `vi.useRealTimers()` for time-dependent tests
- `vi.advanceTimersByTime()` to simulate elapsed time

**Patterns:**

**Fake Implementations (Preferred):**

```typescript
// Create fake objects that implement the same interface
class FakeHttpClient implements IHttpClient {
  public requests: { url: string; options: RequestInit }[] = [];

  async fetch(url: string, options?: RequestInit): Promise<Response> {
    this.requests.push({ url, options: options ?? {} });
    return new Response(null, { status: 204 });
  }
}

// Pass fake into service under test
const fakeHttp = new FakeHttpClient();
const service = new MultiTenantGithubDispatchService(tokenService, fakeHttp);

// Assertions on fake capture
expect(fakeHttp.requests).toHaveLength(1);
expect(fakeHttp.requests[0].url).toBe("https://api.github.com/...");
```

**Mock Functions:**

```typescript
// For simple mocks of individual functions
const mockDispatcher: BuildDispatchServiceI = {
  dispatch: vi.fn().mockResolvedValue(undefined),
};

// Check what was called
expect(mockDispatcher.dispatch).toHaveBeenCalledWith(
  account._id,
  svc._id,
  "dispatch-me",
  "staging",
);
```

**Time Mocking:**

```typescript
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2024-01-15T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

// Test expiry logic
vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000); // 8 days
const session = service.validateSession(token);
expect(session).toBeNull();
```

**What to Mock:**

- External HTTP clients (GitHub, Stripe APIs) - use FakeHttpClient pattern
- Time-dependent behavior - use `vi.useFakeTimers()`
- Simple callback functions - use `vi.fn()`

**What NOT to Mock:**

- Real database (use `MongoMemoryServer` instead)
- Real repositories (test with real MongoMemoryServer instance)
- Real service classes (test behavior, not implementation)
- EventEmitter (use real instance, verify events emitted)
- Crypto/bcrypt functions (let them run, use seeded test data)

## Fixtures and Factories

**Test Data:**

```typescript
// Setup functions create test entities
async function setupTestData() {
  const account = await accountRepo.create({
    name: "My Org",
    slug: "my-org",
  });
  const repository = await repoRepo.create({
    accountId: account._id,
    githubRepoId: 123,
    githubFullName: "org/repo",
    githubOwner: "org",
    githubRepoName: "repo",
    isPrivate: false,
  });
  return { account, repository };
}

// Used in tests
it("should work", async () => {
  const { account, repository } = await setupTestData();
  // ... test logic
});
```

**Location:**

- Fixture data created inline in tests (not external files)
- Repositories passed to factories for creation
- Test entities use meaningful names (e.g., `account`, `service`, `build`)

**In-Memory Database:**

- Every test suite that needs persistence uses `MongoMemoryServer`
- Clean database before each test with `.deleteMany({})`
- Default test account/service created as needed in setup

## Coverage

**Requirements:**

- No minimum enforced
- Coverage tracking available via `@vitest/coverage-v8`

**View Coverage:**

```bash
yarn test:watch -- --coverage
```

## Test Types

**Unit Tests:**

- Scope: Single class/function in isolation
- Approach: Test behavior with mocked dependencies
- Location: `*.test.ts` next to source files
- Examples: `buildService.test.ts`, `sessionService.test.ts`
- Execution: Fast (< 50ms per test)
- Database: Uses MongoMemoryServer (in-memory, fast)

**Integration Tests:**

- Scope: Multiple services/repositories working together
- Approach: Real database (MongoMemoryServer), real services, mocked externals
- Location: `src/tests/` directory
- Examples: `smoke.test.ts`, `publicEndpoint.test.ts`
- Run: `yarn test:smoke` (requires server running for some tests)

**E2E Tests:**

- Scope: Full application flow from UI to API
- Framework: Playwright
- Location: `e2e/` directory (not shown in provided files)
- Run: `yarn test:e2e`

## Common Patterns

**Async Testing:**

```typescript
it("should create build when service belongs to account", async () => {
  // All database calls are async
  const account = await accountRepo.create({
    name: "My Org",
    slug: "my-org",
  });

  // Service calls that invoke database are async
  const build = await service.createBuild({
    accountId: account._id,
    serviceId: svc._id,
    buildId: "abc123",
  });

  // Assertions work synchronously after awaits complete
  expect(build._id).toBeDefined();
});
```

**Error Testing:**

```typescript
it("should reject when service does not exist", async () => {
  const account = await accountRepo.create({
    name: "My Org",
    slug: "my-org-no-service",
  });
  const nonExistentServiceId = new ObjectId();

  // Test expects the operation to throw
  await expect(
    service.createBuild({
      accountId: account._id,
      serviceId: nonExistentServiceId,
      buildId: "abc123",
    }),
  ).rejects.toThrow("Service not found");
});
```

**Event Emission Testing:**

```typescript
it("should emit build:created event when build is created", async () => {
  // Create listener for event
  const eventReceived = vi.fn();
  eventEmitter.on("build:created", eventReceived);

  // Perform action that should emit
  await service.createBuild({ ... });

  // Assert event was emitted with correct data
  expect(eventReceived).toHaveBeenCalledWith(
    expect.objectContaining({
      buildId: "new-build-123",
      serviceId: svc._id.toString(),
      serviceName: "event-service",
    }),
  );
});
```

**Auth Middleware Testing:**

```typescript
it("should attach session to request with valid cookie", async () => {
  // Given: a valid session token
  const userId = new ObjectId();
  const accountId = new ObjectId();
  const token = sessionService.createSession({ userId, accountId });

  // When: I make a request with the session cookie
  const response = await app.inject({
    method: "GET",
    url: "/protected",
    cookies: { session: token },
  });

  // Then: request is authenticated and succeeds
  expect(response.statusCode).toBe(200);
  const body = JSON.parse(response.body);
  expect(body.userId).toBe(userId.toString());
});
```

**Parameter Validation Testing:**

```typescript
it("should reject invalid environment", async () => {
  // Setup valid build
  const account = await accountRepo.create({...});
  const repository = await repoRepo.create({...});
  const svc = await serviceRepo.create({...}); // Has staging, prod
  await service.createBuild({...});

  // Test invalid environment is rejected
  await expect(
    service.updateDeploymentStatus({
      accountId: account._id,
      serviceId: svc._id,
      buildId: "invalid-env-build",
      environment: "invalid-env",
      status: DeploymentStatus.DEPLOYED,
    }),
  ).rejects.toThrow("Invalid environment");
});
```

## Test Behavior, Not Implementation

**CRITICAL:** Tests describe WHAT the system does, not HOW it does it. Tests should pass with different implementations.

**Good Example (Behavior):**

```typescript
it("should return the account when found by slug", async () => {
  // Given an account exists
  await repo.create({ name: "My Org", slug: "my-org" });

  // When I look it up by slug
  const result = await repo.findBySlug("my-org");

  // Then I get the account back
  expect(result?.name).toBe("My Org");
});
```

**Bad Example (Implementation-Coupled):**

```typescript
it("should call collection.findOne with slug filter", async () => {
  // Testing HOW not WHAT - coupled to MongoDB internals
  await repo.findBySlug("my-org");
  expect(mockCollection.findOne).toHaveBeenCalledWith({ slug: "my-org" });
});
```

---

_Testing analysis: 2026-02-07_
