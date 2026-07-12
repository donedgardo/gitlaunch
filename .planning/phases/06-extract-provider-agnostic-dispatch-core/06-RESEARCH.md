# Phase 6: Extract Provider-Agnostic Dispatch Core - Research

**Researched:** 2026-07-12
**Domain:** Refactor / Functional Core extraction — TypeScript, pure functions, TDD
**Confidence:** HIGH

## Summary

Phase 6 is a pure-refactoring phase. No new external dependencies are introduced. The goal is to extract two small, pure (IO-free) functions from the existing imperative dispatch path and wire them in so that the existing GitHub Actions path runs through them with zero observable behavior change.

The codebase is already well-structured for this extraction. A `DeploymentStatus` enum already lives at `src/services/service/deploymentStatus.ts`. The `BuildDispatchServiceI` interface already provides the seam through which the pure `planDispatch` core can slot in without touching `BuildService`. The `github-action` submodule is a separately built Node package with its own `package.json`, `tsconfig.json`, and `vitest` config; it cannot `import` from the main repo's `src/`. Any shared pure logic must either be vendored (copied) into the submodule or published as an npm package — Phase 6 keeps the extraction in the main repo only (Phase 7 deals with the reporter side).

The status-transition logic that needs extracting is currently implicit and scattered across three locations: `BuildService.updateDeploymentStatus` in `src/services/build/buildService.ts` (validates the status enum, checks for DISPATCHING to fire the dispatcher, checks for DEPLOYED to clear other builds), the API route handler at `src/server/routes/api/builds.ts` (validates the status string before calling `updateDeploymentStatus`), and `github-action/src/post.ts` (maps `GITHUB_JOB_STATUS` string to `deployed | error | cancelled`). The post step duplication is the target for Phase 7 (not Phase 6). Phase 6 extracts the server-side outcome-to-status mapping and legal-transition validation, and extracts `planDispatch` as a pure function that returns a typed `DispatchPlan` describing what GitHub Actions parameters to send.

**Primary recommendation:** Create `src/services/dispatch/deployStatus.ts` (pure status/transition core) and `src/services/dispatch/planDispatch.ts` (pure plan function), wire `BuildDispatchService` to call `planDispatch` internally, and confirm all 511 existing server tests and 13 github-action tests remain green.

<phase_requirements>

## Phase Requirements

| ID      | Description                                                                                                                                                         | Research Support                                                                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PROV-01 | Deployment status logic (outcome→status mapping, legal transitions) lives in a single provider-agnostic core used by both the server and the reporter               | A `deployStatus` pure module at `src/services/dispatch/deployStatus.ts` centralizes this. The reporter side is Phase 7.                                      |
| PROV-02 | Deployment dispatch is computed as a provider-agnostic plan; GitHub Actions dispatch runs through it with no observable behavior change (existing tests stay green) | `planDispatch` returns `DispatchPlan {kind:'github', ...}` from pure inputs; `BuildDispatchService` executes the plan. All 511 server tests must stay green. |

</phase_requirements>

## Architectural Responsibility Map

| Capability                                                | Primary Tier                                                                   | Secondary Tier | Rationale                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------- | ---------------------------------------------------------------- |
| Outcome → DeploymentStatus mapping                        | Pure Core (new `deployStatus` module)                                          | —              | No IO; a deterministic mapping belongs in the functional core    |
| Legal transition validation                               | Pure Core (`deployStatus`)                                                     | —              | Same; rejects illegal transitions without touching DB            |
| Dispatch plan computation                                 | Pure Core (`planDispatch`)                                                     | —              | Takes typed data, returns typed `DispatchPlan`; no network calls |
| Executing the dispatch plan (workflow_dispatch HTTP call) | Imperative Shell (`BuildDispatchService` / `MultiTenantGithubDispatchService`) | —              | Requires auth tokens, HTTP — must stay imperative                |
| Status persistence (MongoDB)                              | Data Layer (`BuildRepository`)                                                 | —              | IO; stays unchanged                                              |
| SSE event emission                                        | Imperative Shell (`BuildService`)                                              | —              | Side effect; stays unchanged                                     |

## Standard Stack

This is a refactor phase. No new runtime dependencies are introduced.

### Existing Stack Involved

| Module                             | Version                               | Role in Phase 6                       | File                                               |
| ---------------------------------- | ------------------------------------- | ------------------------------------- | -------------------------------------------------- |
| TypeScript                         | 5.3.x                                 | Type-safe pure functions              | `tsconfig.json`                                    |
| Vitest                             | 1.4.0 (server), 1.6.1 (github-action) | Test runner for pure core             | `vitest.config.ts`                                 |
| `DeploymentStatus` enum            | —                                     | Current status vocabulary             | `src/services/service/deploymentStatus.ts`         |
| `BuildDispatchServiceI`            | —                                     | Seam that `planDispatch` slots into   | `src/services/build/buildDispatchService.ts:10-17` |
| `MultiTenantGithubDispatchService` | —                                     | Executes HTTP dispatch; receives plan | `src/services/github/githubDispatchService.ts`     |
| `BuildService`                     | —                                     | Orchestrator; must NOT be modified    | `src/services/build/buildService.ts`               |

**Installation:** none (no new packages)

## Package Legitimacy Audit

No external packages are installed in Phase 6. This section is not applicable.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
Client trigger (HTMX/API)
        |
        v
BuildService.updateDeploymentStatus(status=DISPATCHING)
        |
        +-- validates DeploymentStatus enum (to be replaced by pure core)
        |
        v [status===DISPATCHING]
BuildDispatchService.dispatch(accountId, serviceId, buildId, env)
        |
        +-- fetchAccount + fetchService + fetchRepo  (IO)
        |
        +-- [NEW] planDispatch(service, providerConfig, build, env)
        |        returns DispatchPlan {kind:'github', installationId, owner, repo, workflowFile, buildId, environment, serviceId}
        |        or ValidationError
        |
        v [DispatchPlan {kind:'github'}]
MultiTenantGithubDispatchService.dispatch(DispatchInput)
        |
        +-- getInstallationToken (IO)
        +-- POST /repos/{owner}/{repo}/actions/workflows/{file}/dispatches (IO)
        |
        v
BuildRepository.updateDeploymentStatus()  (IO)
        |
        v
EventEmitter.emit("build:update")  (SSE)
```

### Recommended Project Structure

```
src/
├── services/
│   ├── dispatch/                        # NEW — pure functional core
│   │   ├── deployStatus.ts              # outcome→status + transition guard
│   │   ├── deployStatus.test.ts         # pure unit tests (no mocks)
│   │   ├── planDispatch.ts              # pure DispatchPlan computation
│   │   └── planDispatch.test.ts         # pure unit tests (no mocks)
│   ├── build/
│   │   ├── buildDispatchService.ts      # MODIFIED — calls planDispatch internally
│   │   ├── buildDispatchService.test.ts # MUST STAY GREEN
│   │   ├── buildService.ts              # UNTOUCHED
│   │   └── buildService.test.ts         # MUST STAY GREEN
│   ├── github/
│   │   └── githubDispatchService.ts     # UNTOUCHED (executes plans)
│   └── service/
│       └── deploymentStatus.ts          # UNTOUCHED (source of truth for enum)
```

### Pattern 1: Pure Functional Core — `deployStatus`

**What:** A pure module that maps CI reporter outcomes to `DeploymentStatus` values and validates legal transitions.

**When to use:** Called by any code (server or reporter) that needs to convert a raw outcome string into a `DeploymentStatus`, or needs to confirm a transition is legal.

**Existing vocabulary** (`src/services/service/deploymentStatus.ts:1-8`):

```typescript
// [VERIFIED: codebase grep]
export enum DeploymentStatus {
  DISPATCHING = "dispatching",
  DEPLOYING = "deploying",
  ERROR = "error",
  CANCELLED = "cancelled",
  DEPLOYED = "deployed",
  NONE = "none",
}
```

**Status vocabulary implicit in `github-action/src/index.ts:71`** (valid statuses the reporter accepts):

```typescript
// [VERIFIED: codebase grep]
const validStatuses = ["deploying", "deployed", "error", "cancelled"];
```

**Target pure module** (proposed shape):

```typescript
// Source: codebase analysis — proposed new file
// src/services/dispatch/deployStatus.ts

import { DeploymentStatus } from "../service/deploymentStatus";

// Outcome type from CI job results
export type CIOutcome = "success" | "failure" | "cancelled";

// Maps CI job outcome to final DeploymentStatus
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

// Legal transition map: from → set of allowed tos
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
  [DeploymentStatus.DEPLOYED]: new Set([DeploymentStatus.DISPATCHING]), // re-deploy allowed
  [DeploymentStatus.ERROR]: new Set([DeploymentStatus.DISPATCHING]),
  [DeploymentStatus.CANCELLED]: new Set([DeploymentStatus.DISPATCHING]),
};

export type TransitionResult = { ok: true } | { ok: false; reason: string };

export function isLegalTransition(
  from: DeploymentStatus,
  to: DeploymentStatus,
): TransitionResult {
  if (LEGAL_TRANSITIONS[from]?.has(to)) {
    return { ok: true };
  }
  return { ok: false, reason: `Illegal transition: ${from} → ${to}` };
}
```

**Note on transition map:** The legal transitions above are inferred from codebase behavior: `BuildService.updateDeploymentStatus` (line 97 in `buildService.ts`) fires the dispatcher on `DISPATCHING`; `dashboard/index.ts` (line 400-401) only allows cancel on `DISPATCHING` or `DEPLOYING`. These transitions should be validated against a characterization test before finalizing. The exact set of legal transitions is `[ASSUMED]` pending explicit confirmation (see Assumptions Log).

### Pattern 2: Pure `planDispatch`

**What:** A pure function that receives typed inputs (no DB, no HTTP) and returns a discriminated union describing what should be dispatched.

**Inputs available at the `BuildDispatchService.dispatch` call site** (all currently fetched via IO in `buildDispatchService.ts:34-64`):

- `account.githubInstallationId` — from `AccountRepository.findById`
- `repository.githubOwner`, `repository.githubRepoName` — from `RepositoryRepository.findById`
- `service.workflowFile` — from `ServiceRepository.findById`
- `buildId`, `environment`, `serviceId` — passed as arguments

**Target pure function** (proposed shape):

```typescript
// Source: codebase analysis — proposed new file
// src/services/dispatch/planDispatch.ts

import { Service } from "../../repositories/serviceRepository";
import { Repository } from "../../repositories/repositoryRepository";

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

// Extensible union — Jenkins plan will be added in Phase 9
export type DispatchPlan = GitHubDispatchPlan;

export type ValidationError = {
  kind: "validation-error";
  reason: string;
};

export type PlanDispatchResult = DispatchPlan | ValidationError;

export type ProviderConfig = {
  github: {
    installationId: number;
  };
  // jenkins: { ... } added in Phase 8
};

export function planDispatch(
  service: Pick<Service, "workflowFile">,
  providerConfig: ProviderConfig,
  repository: Pick<Repository, "githubOwner" | "githubRepoName">,
  buildId: string,
  environment: string,
  serviceId: string,
): PlanDispatchResult {
  if (!providerConfig.github.installationId) {
    return { kind: "validation-error", reason: "GitHub App not installed" };
  }
  return {
    kind: "github",
    installationId: providerConfig.github.installationId,
    owner: repository.githubOwner,
    repo: repository.githubRepoName,
    workflowFile: service.workflowFile,
    buildId,
    environment,
    serviceId,
  };
}
```

**Integration point:** `BuildDispatchService.dispatch` (currently at `src/services/build/buildDispatchService.ts:27-65`) fetches account/service/repo from MongoDB, then calls `planDispatch(service, { github: { installationId } }, repository, buildId, environment, serviceIdStr)`, and finally calls `githubDispatch.dispatch(plan)`. The `DispatchInput` type expected by `MultiTenantGithubDispatchService` is already shaped identically to `GitHubDispatchPlan` minus the `kind` discriminator:

```typescript
// Existing DispatchInput (src/services/github/githubDispatchService.ts:4-12) [VERIFIED: codebase grep]
export type DispatchInput = {
  installationId: number;
  owner: string;
  repo: string;
  workflowFile: string;
  buildId: string;
  environment: string;
  serviceId: string;
};
```

So the integration is: `if (plan.kind === 'github') { const { kind: _, ...input } = plan; await this.githubDispatch.dispatch(input); }`.

### Pattern 3: Characterization Tests Before Refactoring

**What:** Tests that pin the current observable behavior of `BuildDispatchService.dispatch` so any refactor that breaks them will be caught immediately.

**What to pin (the exact GitHub workflow_dispatch call):**

- URL: `https://api.github.com/repos/{owner}/{repo}/actions/workflows/{workflowFile}/dispatches`
- Body: `{ ref: "main", inputs: { environment, buildId, serviceId } }`
- Auth: `Authorization: Bearer {installation_token}`

This contract is already tested in `src/services/github/githubDispatchService.test.ts` using `FakeHttpClient`. Phase 6 adds `planDispatch` and changes `BuildDispatchService` to call it internally, but the `githubDispatchService` tests cover the HTTP contract unchanged.

### Anti-Patterns to Avoid

- **IO inside `deployStatus` or `planDispatch`:** These must be zero-IO pure functions. No DB calls, no HTTP, no environment variables, no `Date.now()`. Tests must use no mocks.
- **Modifying `BuildService`:** The ROADMAP explicitly says "`BuildService` stays untouched." Do not add parameters to `BuildService`, change its constructor, or add dispatch logic to it.
- **Sharing code with `github-action` via `import`:** The `github-action` directory is a separate npm package (`github-action/package.json`) with its own separate build. Its `tsconfig.json` roots at `./src` inside `github-action/`. It cannot import from the main repo's `src/`. Sharing code via npm import or git submodule nesting is not done in Phase 6. The duplication in `github-action/src/post.ts` is addressed in Phase 7.
- **Changing the `DeploymentStatus` enum:** The existing enum at `src/services/service/deploymentStatus.ts` is the canonical location. Do not create a parallel one.
- **Transition enforcement in `BuildService`:** Phase 6 adds the pure `isLegalTransition` function. If transition enforcement is wired into `BuildService`, it must not change the surface behavior that `buildService.test.ts` validates.

## Don't Hand-Roll

| Problem                                | Don't Build                           | Use Instead                                                                           | Why                                                              |
| -------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Outcome string validation              | Custom regex or loose string matching | Discriminated union `CIOutcome` type + TypeScript exhaustive switch                   | Type-system enforces all branches; compiler catches new outcomes |
| Transition validation                  | Ad-hoc if/else                        | Declarative `LEGAL_TRANSITIONS` map (Record<DeploymentStatus, Set<DeploymentStatus>>) | Single source of truth; easily extended for new statuses         |
| Test doubles for IO in pure core tests | Mocks                                 | No mocks needed — pure functions have no IO to mock                                   | CLAUDE.md mandates no mocks for pure collaborators               |

**Key insight:** Pure functions eliminate the entire mocking problem. `deployStatus` and `planDispatch` are deterministic given their arguments; every test is a simple `expect(f(input)).toEqual(output)`.

## Runtime State Inventory

No rename or migration is involved. This section is not applicable.

**Nothing to migrate:** Phase 6 is a server-side code refactor only. No MongoDB collection names, keys, or persisted strings change. The `DeploymentStatus` enum string values (`"dispatching"`, `"deploying"`, etc.) stored in MongoDB are not renamed.

## Common Pitfalls

### Pitfall 1: Transition Enforcement Breaks Existing Tests

**What goes wrong:** If `isLegalTransition` is enforced as a hard block inside `BuildService.updateDeploymentStatus`, some existing test scenarios that set status directly (e.g., going from no prior status to `DEPLOYED`) will fail.

**Why it happens:** `buildService.test.ts` calls `updateDeploymentStatus` with `DEPLOYED` without first setting `DISPATCHING`. The initial state from the repo is `deployments: {}` (empty map — no prior status, equivalent to `NONE`). If the transition guard runs and `NONE → DEPLOYED` is illegal, the test breaks.

**How to avoid:** Two options: (a) only add `isLegalTransition` as an exported utility without enforcing it at the `BuildService` layer in Phase 6 — enforcement can come later; (b) confirm that `NONE → DEPLOYED` is a legal transition (since direct status updates from the reporter are valid). Check existing tests before deciding. Given ROADMAP says "existing tests stay green", option (a) is safer for Phase 6.

**Warning signs:** Any test in `buildService.test.ts` that does `updateDeploymentStatus(..., DEPLOYED)` without first going through `DISPATCHING` will catch this.

### Pitfall 2: `DispatchInput` Type Duplication

**What goes wrong:** Creating `GitHubDispatchPlan` that is structurally identical to the existing `DispatchInput` type, leading to redundant mapping code and two sources of truth.

**Why it happens:** `DispatchInput` is defined in `githubDispatchService.ts`. The `GitHubDispatchPlan` in the new `planDispatch.ts` adds only the `kind` discriminator.

**How to avoid:** Either (a) reuse `DispatchInput` directly by having `GitHubDispatchPlan = DispatchInput & { kind: 'github' }` or (b) define `GitHubDispatchPlan` as the canonical type and have `githubDispatchService.ts` accept it (stripping `kind`). Option (a) creates a cross-module dependency from `dispatch/` into `github/`; option (b) is cleaner for future Jenkins addition. The planner should choose (b) and update `DispatchInput` to be derived from `GitHubDispatchPlan` or simply accept the plan directly.

**Warning signs:** Two nearly-identical type definitions for the same 7-field object.

### Pitfall 3: github-action Package Boundary

**What goes wrong:** Trying to `import` the new `deployStatus` module from `github-action/src/post.ts` in Phase 6.

**Why it happens:** The `github-action` is built by `ncc` from `src/index.ts` and `src/post.ts` in isolation. Its `tsconfig.json` has `"rootDir": "./src"` and only `"include": ["src/**/*"]`. There is no path alias or workspace link between the two packages.

**How to avoid:** Do not add any `import` from `../../../src/...` in the github-action. The `post.ts` outcome-mapping duplication is intentionally left in place until Phase 7 resolves the sharing strategy. Phase 6's scope is the server-side pure core only.

**Warning signs:** TypeScript error in `github-action/` build about resolving paths outside `rootDir`.

### Pitfall 4: `ValidationError` Causing `BuildDispatchService` to Throw Differently

**What goes wrong:** If `planDispatch` returns a `ValidationError` and `BuildDispatchService` throws a differently-worded error than it currently does, callers that match specific error messages (route handlers) will break.

**Why it happens:** `src/server/routes/api/builds.ts:257-258` and `src/server/dashboard/index.ts` match on exact error message strings like `"Account not found"` and `"GitHub App not installed for this account"`.

**How to avoid:** Ensure the `ValidationError.reason` strings produced by `planDispatch` exactly match what the current `BuildDispatchService` throws. Specifically:

- `"Account not found"` — when `accountRepo.findById` returns null
- `"GitHub App not installed for this account"` — when `account.githubInstallationId` is null
- `"Service not found"` — when `serviceRepo.findById` returns null
- `"Repository not found"` — when `repoRepo.findById` returns null

The IO-based checks (account lookup, service lookup, repo lookup) stay in `BuildDispatchService`. Only the plan computation from the resolved data moves to the pure `planDispatch`. This means `planDispatch` only needs to validate that its inputs are complete (e.g., `installationId` is non-null), not do the DB lookups.

**Warning signs:** `buildDispatchService.test.ts` tests that assert specific thrown error messages will catch regressions here.

### Pitfall 5: Tests Relying on Mock Collaboration in `buildDispatchService.test.ts`

**What goes wrong:** The existing `buildDispatchService.test.ts` uses `vi.fn()` to mock `MultiTenantGithubDispatchService.dispatch` and asserts it was called with exact `DispatchInput` arguments. If the internal wiring changes (using `planDispatch` then calling `githubDispatch.dispatch(plan)`), these call-site assertions may break if the argument shape changes.

**Why it happens:** `buildDispatchService.test.ts:93-102` uses:

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

**How to avoid:** Keep `GitHubDispatchPlan` structurally identical to `DispatchInput` (just strip the `kind` discriminator before passing to `githubDispatch.dispatch`). The argument shape is preserved. This test stays green with no changes.

## Code Examples

### Existing `DeploymentStatus` Enum

```typescript
// Source: src/services/service/deploymentStatus.ts (VERIFIED: read file)
export enum DeploymentStatus {
  DISPATCHING = "dispatching",
  DEPLOYING = "deploying",
  ERROR = "error",
  CANCELLED = "cancelled",
  DEPLOYED = "deployed",
  NONE = "none",
}
```

### Existing `BuildDispatchServiceI` Seam

```typescript
// Source: src/services/build/buildDispatchService.ts:10-17 (VERIFIED: read file)
export interface BuildDispatchServiceI {
  dispatch(
    accountId: ObjectId,
    serviceId: ObjectId,
    buildId: string,
    environment: string,
  ): Promise<void>;
}
```

### Existing `DispatchInput` (GitHub-specific)

```typescript
// Source: src/services/github/githubDispatchService.ts:4-12 (VERIFIED: read file)
export type DispatchInput = {
  installationId: number;
  owner: string;
  repo: string;
  workflowFile: string;
  buildId: string;
  environment: string;
  serviceId: string;
};
```

### Current `BuildDispatchService.dispatch` — What It Currently Computes (to reproduce in `planDispatch`)

```typescript
// Source: src/services/build/buildDispatchService.ts:54-62 (VERIFIED: read file)
const input: DispatchInput = {
  installationId: account.githubInstallationId, // number
  owner: repository.githubOwner, // string
  repo: repository.githubRepoName, // string
  workflowFile: service.workflowFile, // string
  buildId, // string (arg)
  environment, // string (arg)
  serviceId: serviceId.toString(), // string (ObjectId.toString())
};
await this.githubDispatch.dispatch(input);
```

### Current `github-action/src/post.ts` — Outcome Mapping (duplicated, NOT removed in Phase 6)

```typescript
// Source: github-action/src/post.ts:19-29 (VERIFIED: read file)
const jobStatus = (process.env.GITHUB_JOB_STATUS || "").toLowerCase();
let status: string;
switch (jobStatus) {
  case "success":
    status = "deployed";
    break;
  case "cancelled":
    status = "cancelled";
    break;
  default:
    status = "error";
    break;
}
```

This logic stays in `post.ts` during Phase 6. Phase 7 moves it to use the shared pure core.

### `Service` type — Fields Needed by `planDispatch`

```typescript
// Source: src/repositories/serviceRepository.ts:7-19 (VERIFIED: read file)
export type Service = {
  _id: ObjectId;
  accountId: ObjectId;
  repositoryId: ObjectId;
  name: string;
  environments: Environment[];
  workflowFile: string; // <-- planDispatch needs this
  eventType: string;
  workflowConfigured: boolean;
  isActive: boolean;
  createdAt: Date;
};
```

### `Account` type — Fields Needed by `planDispatch`

```typescript
// Source: src/repositories/accountRepository.ts:18-31 (VERIFIED: read file)
export type Account = {
  _id: ObjectId;
  // ...
  githubInstallationId: number | null; // <-- planDispatch needs this
  // ...
};
```

### Characterization Test Pattern (for pre-refactor)

```typescript
// Pattern to add to buildDispatchService.test.ts before refactoring:
it("should produce exactly the same workflow_dispatch call after planDispatch refactor", async () => {
  // Given: known account, repo, service setup (same as existing test)
  // When: dispatch is called
  // Then: githubDispatch.dispatch is called with EXACTLY this shape
  expect(mockGithubDispatch.dispatch).toHaveBeenCalledWith({
    installationId: 12345,
    owner: "org",
    repo: "repo",
    workflowFile: "deploy-backend.yml",
    buildId: "build-123",
    environment: "staging",
    serviceId: svc._id.toString(),
  });
  // NOTE: This is already tested! No new test needed here.
  // The existing test in buildDispatchService.test.ts:65-101 is the characterization test.
});
```

## State of the Art

| Old Approach                                                         | Current Approach                                | When Changed | Impact                                                                   |
| -------------------------------------------------------------------- | ----------------------------------------------- | ------------ | ------------------------------------------------------------------------ |
| Ad-hoc status strings in route handlers                              | `DeploymentStatus` enum (already in place)      | Existing     | Phase 6 deepens this by adding `outcomeToStatus` and `isLegalTransition` |
| All dispatch logic in `BuildDispatchService` (monolithic imperative) | `planDispatch` pure function + imperative shell | Phase 6      | Enables Jenkins dispatch in Phase 9 without touching `BuildService`      |

**Deprecated/outdated:**

- Inline outcome switch in `github-action/src/post.ts` — stays for Phase 6, migrated in Phase 7
- Status validation spread across `buildService.ts:92` (`Object.values(DeploymentStatus).includes`) and `builds.ts:288` — can consolidate into `deployStatus` module

## Assumptions Log

| #   | Claim                                                                                                                                         | Section                          | Risk if Wrong                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Legal transitions: `NONE→DISPATCHING`, `DISPATCHING→DEPLOYING                                                                                 | CANCELLED                        | ERROR`, `DEPLOYING→DEPLOYED                                                                                   | CANCELLED | ERROR`, terminal→DISPATCHING (re-deploy) | Architecture Patterns, Pattern 1 | If `BuildService` tests call transitions not in this set, `isLegalTransition` enforcement would break them; mitigation: don't enforce in Phase 6, only export the validator |
| A2  | `planDispatch` only validates the resolved (post-IO) data, not the DB lookup; account/service/repo null-checks stay in `BuildDispatchService` | Architecture Patterns, Pattern 2 | If null-checks move into `planDispatch`, it needs nullable input types and the IO vs pure boundary is muddied |
| A3  | The `github-action` submodule cannot import from the main repo's `src/` at build time                                                         | Common Pitfalls, Pitfall 3       | Trivially verifiable; `tsconfig.json` rootDir and ncc build confirm this                                      |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed.

The transition map (A1) is the only item needing confirmation. The safest implementation exports `isLegalTransition` without enforcing it at the `BuildService` layer in Phase 6, so existing tests stay green regardless.

## Open Questions

1. **Should `isLegalTransition` be enforced in Phase 6 or just exported?**

   - What we know: `buildService.test.ts` makes direct status jumps (e.g., status=`DEPLOYED` without prior `DISPATCHING`) which may violate strict transition rules
   - What's unclear: Whether the test data mirrors a real legal sequence (the build is freshly created with `deployments: {}` which is `NONE`, and `NONE → DEPLOYED` may be intentionally allowed for reporter-driven updates)
   - Recommendation: Export `isLegalTransition` as a pure utility but do NOT enforce it inside `BuildService.updateDeploymentStatus` in Phase 6. Phase 7 can add enforcement once the full transition map is agreed upon.

2. **Should `DispatchPlan` extend `DispatchInput` or replace it?**
   - What we know: `DispatchInput` has 7 fields; `GitHubDispatchPlan` would have the same 7 fields plus `kind: 'github'`
   - What's unclear: Whether `githubDispatchService.ts` should be updated to accept `GitHubDispatchPlan` directly or continue accepting `DispatchInput`
   - Recommendation: Keep `DispatchInput` unchanged in Phase 6. `BuildDispatchService` strips `kind` before calling `githubDispatch.dispatch(input)`. This minimizes diff surface and keeps all existing tests green with zero changes to `githubDispatchService.ts`.

## Environment Availability

Step 2.6: SKIPPED (no external dependencies — this is a code-only refactor with no new tools, services, or CLIs required)

## Validation Architecture

### Test Framework

| Property           | Value                                                       |
| ------------------ | ----------------------------------------------------------- |
| Framework          | Vitest 1.4.0 (server), 1.6.1 (github-action submodule)      |
| Config file        | `vitest.config.ts` (server — excludes `src/tests/`, `e2e/`) |
| Quick run command  | `yarn test` (in `/` — runs 511 server tests)                |
| Full suite command | `yarn test && cd github-action && yarn test`                |

### Phase Requirements → Test Map

| Req ID  | Behavior                                                                                 | Test Type   | Automated Command               | File Exists?                                  |
| ------- | ---------------------------------------------------------------------------------------- | ----------- | ------------------------------- | --------------------------------------------- |
| PROV-01 | `outcomeToStatus("success")` returns `DEPLOYED`                                          | unit        | `yarn test`                     | ❌ Wave 0                                     |
| PROV-01 | `outcomeToStatus("cancelled")` returns `CANCELLED`                                       | unit        | `yarn test`                     | ❌ Wave 0                                     |
| PROV-01 | `outcomeToStatus("failure")` returns `ERROR`                                             | unit        | `yarn test`                     | ❌ Wave 0                                     |
| PROV-01 | `isLegalTransition(DISPATCHING, DEPLOYING)` returns `{ ok: true }`                       | unit        | `yarn test`                     | ❌ Wave 0                                     |
| PROV-01 | `isLegalTransition(DEPLOYED, DISPATCHING)` returns `{ ok: true }` (re-deploy)            | unit        | `yarn test`                     | ❌ Wave 0                                     |
| PROV-01 | `isLegalTransition(NONE, DEPLOYED)` returns `{ ok: false }` (illegal)                    | unit        | `yarn test`                     | ❌ Wave 0                                     |
| PROV-02 | `planDispatch(service, providerConfig, repo, ...)` returns `GitHubDispatchPlan`          | unit        | `yarn test`                     | ❌ Wave 0                                     |
| PROV-02 | `planDispatch(...)` returns `ValidationError` when `installationId` is null              | unit        | `yarn test`                     | ❌ Wave 0                                     |
| PROV-02 | `BuildDispatchService.dispatch` produces identical workflow_dispatch call after refactor | integration | `yarn test`                     | ✅ existing `buildDispatchService.test.ts:65` |
| PROV-02 | All 511 existing server tests stay green                                                 | regression  | `yarn test`                     | ✅ existing suite                             |
| PROV-02 | All 13 github-action tests stay green                                                    | regression  | `cd github-action && yarn test` | ✅ existing suite                             |

### Sampling Rate

- **Per task commit:** `yarn test` (server suite — 511 tests, ~15s)
- **Per wave merge:** `yarn test && cd github-action && yarn test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/services/dispatch/deployStatus.ts` — pure module (REQ PROV-01)
- [ ] `src/services/dispatch/deployStatus.test.ts` — pure unit tests, no mocks (REQ PROV-01)
- [ ] `src/services/dispatch/planDispatch.ts` — pure plan function (REQ PROV-02)
- [ ] `src/services/dispatch/planDispatch.test.ts` — pure unit tests, no mocks (REQ PROV-02)

No framework install needed — Vitest is already configured.

## Security Domain

This phase introduces no new attack surface. It is a pure internal refactoring:

- No new HTTP endpoints
- No new authentication/authorization paths
- No new data persistence
- No new secrets or credentials handling

ASVS categories are not applicable for this phase.

## Sources

### Primary (HIGH confidence)

- `src/services/service/deploymentStatus.ts` — canonical `DeploymentStatus` enum (read file)
- `src/services/build/buildDispatchService.ts` — `BuildDispatchServiceI` seam + `BuildDispatchService` implementation (read file)
- `src/services/build/buildService.ts` — `BuildService.updateDeploymentStatus` logic (read file)
- `src/services/github/githubDispatchService.ts` — `DispatchInput` type + `MultiTenantGithubDispatchService` (read file)
- `github-action/src/post.ts` — duplicated outcome→status mapping (read file)
- `github-action/src/index.ts` — status validation vocabulary `["deploying","deployed","error","cancelled"]` (read file)
- `src/services/build/buildDispatchService.test.ts` — existing dispatch tests (read file)
- `src/services/build/buildService.test.ts` — existing BuildService tests (read file)
- `src/services/github/githubDispatchService.test.ts` — HTTP contract tests with FakeHttpClient (read file)
- `github-action/package.json` + `github-action/tsconfig.json` — confirms separate build, `rootDir: ./src` (read files)
- `vitest.config.ts` — test exclusion rules (read file)
- `src/server/routes/api/builds.ts` — how routes pass statuses to BuildService (read file)
- `src/server/dashboard/index.ts:395-415` — cancel logic (DISPATCHING/DEPLOYING guard) (read file)
- `src/repositories/serviceRepository.ts`, `src/repositories/accountRepository.ts` — `Service` and `Account` types (read files)
- `yarn test` output — 511 tests passing, baseline confirmed
- `cd github-action && yarn test` output — 13 tests passing, baseline confirmed

### Secondary (MEDIUM confidence)

- `.planning/ROADMAP.md` Phase 6 notes — design intent for `planDispatch` signature and `DispatchPlan` discriminated union
- `.planning/STATE.md` — "functional-core/imperative-shell for CI providers" architectural decision

### Tertiary (LOW confidence)

- None — all claims are verified from codebase or planning documents

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new packages; all existing packages verified by running tests
- Architecture: HIGH — all types and call sites verified by reading actual source files with line citations
- Pitfalls: HIGH — identified from reading both source and test files; exact error message strings and test assertions verified
- Transition map: MEDIUM — inferred from behavioral analysis; exact legal set is `[ASSUMED]` (A1)

**Research date:** 2026-07-12
**Valid until:** Stable — no external dependencies; valid as long as `buildService.ts`, `buildDispatchService.ts`, `githubDispatchService.ts` are not modified before planning starts
