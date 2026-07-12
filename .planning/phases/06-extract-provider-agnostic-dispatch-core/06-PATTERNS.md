# Phase 6: Extract Provider-Agnostic Dispatch Core - Pattern Map

**Mapped:** 2026-07-12
**Files analyzed:** 5 (2 new source, 2 new test, 1 modified)
**Analogs found:** 5 / 5

## File Classification

| New/Modified File                            | Role           | Data Flow        | Closest Analog                               | Match Quality               |
| -------------------------------------------- | -------------- | ---------------- | -------------------------------------------- | --------------------------- |
| `src/services/dispatch/deployStatus.ts`      | utility (pure) | transform        | `src/services/auth/sessionService.ts`        | role-match (pure, no IO)    |
| `src/services/dispatch/deployStatus.test.ts` | test           | transform        | `src/services/auth/sessionService.test.ts`   | exact (pure unit, no mocks) |
| `src/services/dispatch/planDispatch.ts`      | utility (pure) | transform        | `src/services/auth/sessionService.ts`        | role-match (pure, no IO)    |
| `src/services/dispatch/planDispatch.test.ts` | test           | transform        | `src/services/auth/sessionService.test.ts`   | exact (pure unit, no mocks) |
| `src/services/build/buildDispatchService.ts` | service        | request-response | `src/services/build/buildDispatchService.ts` | self (modification)         |

---

## Pattern Assignments

### `src/services/dispatch/deployStatus.ts` (utility/pure, transform)

**Analog:** `src/services/auth/sessionService.ts`

**Why this analog:** `SessionService` is the clearest example in the codebase of a pure TypeScript module — no DB, no HTTP, no EventEmitter. It exports types + a class with deterministic methods. The new `deployStatus` module is even simpler: standalone exported functions, no class needed.

**Imports pattern** (`src/services/auth/sessionService.ts` lines 1-2):

```typescript
import { DeploymentStatus } from "../service/deploymentStatus";
```

(Single relative import from the canonical enum. No DB, no HTTP, no external packages.)

**Type export pattern** (`src/services/auth/sessionService.ts` lines 3-16):

```typescript
export type CIOutcome = "success" | "failure" | "cancelled";

export type TransitionResult = { ok: true } | { ok: false; reason: string };
```

(Discriminated union return type — same pattern used by `SessionPayload`. Export types alongside functions in the same file.)

**Core pure function pattern** (`src/services/auth/sessionService.ts` lines 28-37):

```typescript
export function outcomeToStatus(outcome: CIOutcome): DeploymentStatus {
  switch (outcome) {
    case "success":
      return DeploymentStatus.DEPLOYED;
    case "cancelled":
      return DeploymentStatus.CANCELLED;
    default:
      return DeploymentStatus.ERROR;
  }
}
```

(Exhaustive switch on a discriminated union type. No try/catch needed — pure function never throws.)

**Declarative data structure pattern** (from RESEARCH.md analysis of `src/services/build/buildService.ts`):

```typescript
const LEGAL_TRANSITIONS: Record<DeploymentStatus, Set<DeploymentStatus>> = {
  [DeploymentStatus.NONE]: new Set([DeploymentStatus.DISPATCHING]),
  [DeploymentStatus.DISPATCHING]: new Set([
    DeploymentStatus.DEPLOYING,
    DeploymentStatus.CANCELLED,
    DeploymentStatus.ERROR,
  ]),
  [DeploymentStatus.DEPLOYING]: new Set([
    DeploymentStatus.DEPLOYED,
    DeploymentStatus.CANCELLED,
    DeploymentStatus.ERROR,
  ]),
  [DeploymentStatus.DEPLOYED]: new Set([DeploymentStatus.DISPATCHING]),
  [DeploymentStatus.ERROR]: new Set([DeploymentStatus.DISPATCHING]),
  [DeploymentStatus.CANCELLED]: new Set([DeploymentStatus.DISPATCHING]),
};
```

(Module-level `const`, not exported. Single source of truth. `Record<K, Set<K>>` is the idiomatic pattern for transition maps in this codebase's TS style.)

**Guard function pattern** (`src/services/auth/sessionService.ts` lines 40-47 — `validateSession` returning null on failure):

```typescript
export function isLegalTransition(
  from: DeploymentStatus,
  to: DeploymentStatus,
): TransitionResult {
  if (LEGAL_TRANSITIONS[from]?.has(to)) {
    return { ok: true };
  }
  return { ok: false, reason: `Illegal transition: ${from} -> ${to}` };
}
```

(Returns a typed result object, never throws. Same pattern as `validateSession` returning `null | SessionPayload`.)

**No error handling needed:** Pure functions with no IO do not need try/catch. The `sessionService.ts` `validateSession` uses try/catch only because `jwt.verify` can throw — `deployStatus` functions are total and cannot throw.

---

### `src/services/dispatch/deployStatus.test.ts` (test, transform)

**Analog:** `src/services/auth/sessionService.test.ts`

**Why this analog:** `sessionService.test.ts` is the single best example of a pure-unit test in the codebase — no MongoDB, no `beforeAll`/`afterAll`, no `vi.fn()`, no fake implementations. Every test is `expect(f(input)).toEqual(output)`. This is exactly the pattern required for `deployStatus.test.ts`.

**Imports pattern** (`src/services/auth/sessionService.test.ts` lines 1-3):

```typescript
import { describe, it, expect } from "vitest";
import { DeploymentStatus } from "../service/deploymentStatus";
import { outcomeToStatus, isLegalTransition } from "./deployStatus";
```

(Import only `describe`, `it`, `expect` from vitest — no `beforeAll`, `afterAll`, `vi`, or MongoDB imports. Named imports from the module under test.)

**Test structure pattern** (`src/services/auth/sessionService.test.ts` lines 4-8, 18-33):

```typescript
describe("deployStatus", () => {
  describe("outcomeToStatus", () => {
    it("should return DEPLOYED when outcome is success", () => {
      // Given/When/Then in one line — pure functions need no setup
      expect(outcomeToStatus("success")).toBe(DeploymentStatus.DEPLOYED);
    });

    it("should return CANCELLED when outcome is cancelled", () => {
      expect(outcomeToStatus("cancelled")).toBe(DeploymentStatus.CANCELLED);
    });

    it("should return ERROR when outcome is failure", () => {
      expect(outcomeToStatus("failure")).toBe(DeploymentStatus.ERROR);
    });
  });

  describe("isLegalTransition", () => {
    it("should return ok: true for DISPATCHING -> DEPLOYING", () => {
      const result = isLegalTransition(
        DeploymentStatus.DISPATCHING,
        DeploymentStatus.DEPLOYING,
      );
      expect(result).toEqual({ ok: true });
    });

    it("should return ok: false for NONE -> DEPLOYED", () => {
      const result = isLegalTransition(
        DeploymentStatus.NONE,
        DeploymentStatus.DEPLOYED,
      );
      expect(result.ok).toBe(false);
      expect((result as { ok: false; reason: string }).reason).toContain(
        "Illegal transition",
      );
    });
  });
});
```

(No `beforeEach`, no `beforeAll`, no `vi.fn()`. Each test is self-contained. Comment style follows `// Given/When/Then` from CLAUDE.md convention, collapsed into single assertions where the pure function makes setup trivial.)

**Naming convention** (from CLAUDE.md):

```
describe("moduleName", () => {
  describe("functionName", () => {
    it("should [expected behavior] when [condition]", () => { ... });
  });
});
```

---

### `src/services/dispatch/planDispatch.ts` (utility/pure, transform)

**Analog:** `src/services/auth/sessionService.ts` (pure transformation module)

**Why this analog:** `planDispatch` is a pure function that maps typed inputs to a typed output (`DispatchPlan | ValidationError`). `sessionService.ts` shows the idiomatic module layout: types first, then functions, no class needed when state is absent.

**Imports pattern** (`src/services/github/githubDispatchService.ts` lines 4-12 — reuse existing types):

```typescript
import { Service } from "../../repositories/serviceRepository";
import { Repository } from "../../repositories/repositoryRepository";
import { DispatchInput } from "../github/githubDispatchService";
```

(Import `Pick<Service, "workflowFile">` and `Pick<Repository, "githubOwner" | "githubRepoName">` via structural typing — no need to import the full types if only fields are needed. Import `DispatchInput` from `githubDispatchService` to avoid duplicating the 7-field shape.)

**Type export pattern** (from RESEARCH.md proposed shape, aligning with existing `DispatchInput` at `src/services/github/githubDispatchService.ts` lines 4-12):

```typescript
export type GitHubDispatchPlan = {
  kind: "github";
  installationId: number;
  owner: string;
  repo: string;
  workflowFile: string;
  buildId: string;
  environment: string;
  serviceId: string;
};

export type DispatchPlan = GitHubDispatchPlan;
// Note: Jenkins plan added Phase 9 as: export type DispatchPlan = GitHubDispatchPlan | JenkinsPlan;

export type ValidationError = {
  kind: "validation-error";
  reason: string;
};

export type PlanDispatchResult = DispatchPlan | ValidationError;
```

(Discriminated union on `kind`. Extensible for Phase 9 Jenkins without changing existing callers.)

**Core pure function pattern** (modeled on `sessionService.ts` `createSession`, lines 29-37):

```typescript
export function planDispatch(
  service: Pick<Service, "workflowFile">,
  installationId: number,
  repository: Pick<Repository, "githubOwner" | "githubRepoName">,
  buildId: string,
  environment: string,
  serviceId: string,
): PlanDispatchResult {
  if (!installationId) {
    return {
      kind: "validation-error",
      reason: "GitHub App not installed for this account",
    };
  }
  return {
    kind: "github",
    installationId,
    owner: repository.githubOwner,
    repo: repository.githubRepoName,
    workflowFile: service.workflowFile,
    buildId,
    environment,
    serviceId,
  };
}
```

(No try/catch — pure function cannot throw. The `reason` string in `ValidationError` MUST match the exact error strings thrown by `BuildDispatchService` today, per RESEARCH.md Pitfall 4. Specifically: `"GitHub App not installed for this account"` at `buildDispatchService.ts:39`.)

**CRITICAL — error message strings to preserve** (from `src/services/build/buildDispatchService.ts` lines 35-51):

- `"Account not found"` (line 36) — stays in `BuildDispatchService`, not in `planDispatch`
- `"GitHub App not installed for this account"` (line 39) — `planDispatch` returns this as `ValidationError.reason`
- `"Service not found"` (line 44) — stays in `BuildDispatchService`
- `"Repository not found"` (line 50) — stays in `BuildDispatchService`

---

### `src/services/dispatch/planDispatch.test.ts` (test, transform)

**Analog:** `src/services/auth/sessionService.test.ts`

**Why this analog:** Same rationale as `deployStatus.test.ts`. Pure function, no IO, no mocks.

**Imports pattern**:

```typescript
import { describe, it, expect } from "vitest";
import {
  planDispatch,
  GitHubDispatchPlan,
  ValidationError,
} from "./planDispatch";
```

**Test structure pattern** (`src/services/auth/sessionService.test.ts` lines 18-32 — one assertion per outcome):

```typescript
describe("planDispatch", () => {
  const validService = { workflowFile: "deploy-backend.yml" };
  const validRepo = { githubOwner: "org", githubRepoName: "repo" };
  const installationId = 12345;

  it("should return GitHubDispatchPlan when all inputs are valid", () => {
    const result = planDispatch(
      validService,
      installationId,
      validRepo,
      "build-123",
      "staging",
      "svc-abc",
    );

    expect(result).toEqual({
      kind: "github",
      installationId: 12345,
      owner: "org",
      repo: "repo",
      workflowFile: "deploy-backend.yml",
      buildId: "build-123",
      environment: "staging",
      serviceId: "svc-abc",
    });
  });

  it("should return ValidationError when installationId is null", () => {
    const result = planDispatch(
      validService,
      null as unknown as number,
      validRepo,
      "build-123",
      "staging",
      "svc-abc",
    );

    expect((result as ValidationError).kind).toBe("validation-error");
    expect((result as ValidationError).reason).toBe(
      "GitHub App not installed for this account",
    );
  });
});
```

(Shared fixtures declared at `describe` scope — same pattern as `sessionService.test.ts` line 7 `const secret = ...`. No `beforeEach` needed for pure functions.)

---

### `src/services/build/buildDispatchService.ts` (service, request-response — MODIFY)

**Analog:** Self — this file is being modified, not rewritten.

**Current implementation** (`src/services/build/buildDispatchService.ts` lines 1-66) — read this file before modifying.

**Integration change pattern** (new code to add after IO fetches, replacing lines 54-64):

```typescript
// After: account, service, repository are fetched (lines 34-51)
// Replace the inline DispatchInput construction with planDispatch call:

const plan = planDispatch(
  service,
  account.githubInstallationId,
  repository,
  buildId,
  environment,
  serviceId.toString(),
);

if (plan.kind === "validation-error") {
  throw new Error(plan.reason);
}

const { kind: _kind, ...input } = plan;
await this.githubDispatch.dispatch(input);
```

**Import addition** (prepend to existing imports at line 1):

```typescript
import { planDispatch } from "../dispatch/planDispatch";
```

**Contract that MUST remain unchanged** — `buildDispatchService.test.ts` lines 93-101 asserts:

```typescript
expect(mockGithubDispatch.dispatch).toHaveBeenCalledWith({
  installationId: 12345,
  owner: "org",
  repo: "repo",
  workflowFile: "deploy-backend.yml",
  buildId: "build-123",
  environment: "staging",
  serviceId: svc._id.toString(),
});
```

The destructured `{ kind: _kind, ...input }` spread must produce this exact shape. `DispatchInput` at `githubDispatchService.ts:4-12` has exactly these 7 fields — `GitHubDispatchPlan` adds only `kind`, so stripping it with destructuring restores the original shape.

---

## Shared Patterns

### Pure Module Layout

**Source:** `src/services/auth/sessionService.ts` (entire file, 51 lines)
**Apply to:** `deployStatus.ts`, `planDispatch.ts`

The codebase convention for a pure module:

1. Import block (only types/enums needed — no DB, no HTTP)
2. Exported type aliases and discriminated unions
3. Module-level private constants (e.g., `LEGAL_TRANSITIONS`)
4. Exported functions (named exports, not a class)
5. No default exports
6. No try/catch unless calling a third-party function that throws

### Pure Test Layout

**Source:** `src/services/auth/sessionService.test.ts` (entire file, 128 lines)
**Apply to:** `deployStatus.test.ts`, `planDispatch.test.ts`

```typescript
import { describe, it, expect } from "vitest";
// NO: beforeAll, afterAll, vi, MongoMemoryServer, MongoClient
```

Test structure:

- No `beforeAll` / `afterAll` (no DB setup needed)
- `beforeEach` only if shared mutable state exists (not needed for pure functions)
- Shared fixtures as `const` at `describe` scope
- Given/When/Then comments collapsed to single `expect()` for trivial pure cases
- One behavior per `it()` block

### Error String Convention

**Source:** `src/services/build/buildDispatchService.ts` lines 35-51
**Apply to:** `planDispatch.ts` `ValidationError.reason` values

Error strings are bare English phrases with no punctuation suffix:

- `"Account not found"`
- `"GitHub App not installed for this account"`
- `"Service not found"`
- `"Repository not found"`

`planDispatch` only produces the `"GitHub App not installed for this account"` error (post-IO validation). The other three stay as `throw new Error(...)` in `BuildDispatchService`.

### Discriminated Union Return Type

**Source:** `src/services/auth/sessionService.ts` lines 40-47 (`validateSession` returning `SessionPayload | null`)
**Apply to:** `deployStatus.ts` `TransitionResult`, `planDispatch.ts` `PlanDispatchResult`

The codebase prefers typed result objects over thrown exceptions for expected failures in pure code. Use `{ ok: true } | { ok: false; reason: string }` for validation results (not exceptions). For `planDispatch`, use `DispatchPlan | ValidationError` discriminated on `kind`.

### Vitest Import Convention

**Source:** `src/services/auth/sessionService.test.ts` line 1, `src/services/github/githubDispatchService.test.ts` line 1
**Apply to:** All new test files

```typescript
// Pure test (no mocks needed):
import { describe, it, expect } from "vitest";

// Service test with fake collaborators (no vi.fn()):
import { describe, it, expect, beforeEach } from "vitest";

// Test with mongo (integration):
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
```

---

## No Analog Found

All files have analogs. No entries in this section.

---

## Key Decisions from RESEARCH.md for Planner

These are load-bearing constraints the planner must embed in task actions:

1. **`planDispatch` signature:** Takes resolved (post-IO) values, not `ObjectId`s. The `installationId` is `number`, not `account.githubInstallationId` (so `BuildDispatchService` passes the value, not the account object). This keeps the pure/impure boundary clean.

2. **`ValidationError.reason` string:** Must be `"GitHub App not installed for this account"` (verbatim from `buildDispatchService.ts:39`) so `buildDispatchService.test.ts` error-message assertions stay green.

3. **`kind` discriminator stripping:** `BuildDispatchService` must destructure `{ kind: _kind, ...input }` before calling `githubDispatch.dispatch(input)` to preserve the existing `DispatchInput` shape tested at `buildDispatchService.test.ts:93-101`.

4. **`isLegalTransition` — export only, do NOT enforce:** Per RESEARCH.md Pitfall 1 and Open Question 1, do not enforce transition validation inside `BuildService.updateDeploymentStatus` in Phase 6. Export the function as a utility only.

5. **`DeploymentStatus` enum location:** Import from `"../service/deploymentStatus"` (relative path from `src/services/dispatch/`). Do NOT create a second enum.

6. **Test runner:** `yarn test` in repo root (Vitest 1.4.0, excludes `src/tests/**` and `e2e/**`).

---

## Metadata

**Analog search scope:** `src/services/` (all subdirectories)
**Files scanned:** 12 source files, 4 test files
**Pattern extraction date:** 2026-07-12
