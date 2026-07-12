---
phase: 06-extract-provider-agnostic-dispatch-core
plan: "02"
subsystem: dispatch
tags: [typescript, pure-function, discriminated-union, tdd, vitest]

requires:
  - phase: 06-extract-provider-agnostic-dispatch-core/06-01
    provides: deployStatus pure module establishing dispatch/ directory and pure-module pattern

provides:
  - planDispatch pure function computing DispatchPlan | ValidationError from resolved inputs with no IO
  - GitHubDispatchPlan discriminated union type (kind:"github") mirroring DispatchInput + kind
  - ValidationError type (kind:"validation-error") with verbatim reason string
  - PlanDispatchResult union type for type-safe result handling
  - No-mock unit tests covering happy path and ValidationError path

affects:
  - 06-03 (BuildDispatchService integration wiring through planDispatch)
  - 09 (Jenkins provider — adds JenkinsPlan to DispatchPlan union)

tech-stack:
  added: []
  patterns:
    - pure-module layout (types first, then functions, no class, no IO)
    - discriminated union on kind for DispatchPlan vs ValidationError
    - Pick<T, fields> structural typing for pure function inputs

key-files:
  created:
    - src/services/dispatch/planDispatch.ts
    - src/services/dispatch/planDispatch.test.ts
  modified: []

key-decisions:
  - "planDispatch accepts resolved (post-IO) values — installationId as number, not account object — pure/impure boundary stays clean"
  - "ValidationError.reason verbatim 'GitHub App not installed for this account' matches buildDispatchService.ts:39 so Plan 03 integration keeps assertions green"
  - "DispatchPlan union kept single-member (GitHubDispatchPlan only) — Jenkins member added Phase 9 without changing callers"

patterns-established:
  - "pure planDispatch module: no IO, no try/catch, no DB, typed result union"

requirements-completed: [PROV-02]

duration: 5min
completed: 2026-07-12
---

# Phase 06 Plan 02: planDispatch Pure Dispatch-Plan Computation Summary

**Pure `planDispatch` function computes a `GitHubDispatchPlan | ValidationError` discriminated union from already-resolved inputs with zero IO, covered by no-mock unit tests using the sessionService.test.ts pattern**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-12T02:47:00Z
- **Completed:** 2026-07-12T02:52:00Z
- **Tasks:** 3 (RED, GREEN, REFACTOR+regression)
- **Files modified:** 2

## Accomplishments

- `planDispatch.ts` pure function: returns `GitHubDispatchPlan` (kind:"github") on valid inputs, `ValidationError` (kind:"validation-error") when installationId is falsy
- `GitHubDispatchPlan` structurally mirrors `DispatchInput` 7 fields + `kind` discriminator — stripping `kind` restores the exact shape
- No-mock unit tests confirm happy path and ValidationError path without any DB, mocks, or beforeAll setup
- Full server suite (529 tests, 53 files) and github-action suite (13 tests) remain green
- Scope boundary confirmed: `buildDispatchService.ts`, `githubDispatchService.ts`, and `github-action/` untouched

## Task Commits

1. **Task 1: RED — write no-mock unit tests** - `f2f7174` (test)
2. **Task 2: GREEN — implement pure planDispatch** - `7a60bf3` (feat)
3. **Task 3: REFACTOR + regression** - no refactor commit needed (code was already clean; full suite verified green)

## Files Created/Modified

- `src/services/dispatch/planDispatch.ts` - Pure function exporting `planDispatch`, `GitHubDispatchPlan`, `DispatchPlan`, `ValidationError`, `PlanDispatchResult`; no IO
- `src/services/dispatch/planDispatch.test.ts` - No-mock unit tests: happy path (full 8-field object assertion) and ValidationError path (verbatim reason string)

## Decisions Made

- `planDispatch` takes `installationId: number` directly (not the account object) to keep the pure/impure boundary clean — `BuildDispatchService` (Plan 03) passes the resolved value
- `ValidationError.reason` is verbatim `"GitHub App not installed for this account"` matching `buildDispatchService.ts:39` so Plan 03 integration assertions stay green without modification
- `DispatchPlan` is single-member union now; Jenkins member added Phase 9 as `GitHubDispatchPlan | JenkinsPlan` without changing existing callers
- No imports from `githubDispatchService.ts` — `GitHubDispatchPlan` inline-replicates the 7 fields to avoid coupling the pure module to the imperative shell

## Deviations from Plan

None - plan executed exactly as written. No refactoring was needed in Task 3; the implementation from Task 2 was already clean and idiomatic.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `planDispatch` is ready for Plan 03 to wire `BuildDispatchService` through it
- Plan 03 integration pattern: call `planDispatch(service, account.githubInstallationId, repository, buildId, environment, serviceId.toString())`, check `plan.kind === "validation-error"` and `throw new Error(plan.reason)`, then destructure `{ kind: _kind, ...input }` before calling `githubDispatch.dispatch(input)`
- No blockers

---

_Phase: 06-extract-provider-agnostic-dispatch-core_
_Completed: 2026-07-12_
