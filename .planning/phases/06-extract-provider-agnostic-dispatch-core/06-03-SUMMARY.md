---
phase: 06-extract-provider-agnostic-dispatch-core
plan: "03"
subsystem: dispatch
tags:
  [
    typescript,
    refactor,
    dependency-injection,
    pure-function,
    discriminated-union,
  ]

requires:
  - phase: 06-extract-provider-agnostic-dispatch-core/06-02
    provides: planDispatch pure function computing GitHubDispatchPlan | ValidationError from resolved inputs

provides:
  - BuildDispatchService.dispatch routes through planDispatch core with zero observable behavior change
  - GitHub dispatch path fully wired through provider-agnostic pure function
  - kind discriminator stripped before githubDispatch.dispatch call, preserving exact DispatchInput shape

affects:
  - 09 (Jenkins provider — planDispatch union extended with JenkinsPlan; BuildDispatchService routing already in place)

tech-stack:
  added: []
  patterns:
    - functional-core/imperative-shell integration splice pattern
    - kind-strip destructuring to bridge discriminated union to existing typed input shape

key-files:
  created: []
  modified:
    - src/services/build/buildDispatchService.ts

key-decisions:
  - "kind stripped via const { kind: _kind, ...input } = plan; before githubDispatch.dispatch(input) — preserves exact DispatchInput 7-field shape asserted by characterization test"
  - "ValidationError branch kept in BuildDispatchService even though planDispatch ValidationError is effectively unreachable here — guard exists for future non-GitHub callers"
  - "DispatchInput import removed from buildDispatchService.ts — no longer needed after planDispatch handles construction"

patterns-established:
  - "integration splice: IO in imperative shell, construction in pure core, kind stripped at boundary"

requirements-completed: [PROV-02]

duration: 5min
completed: 2026-07-12
---

# Phase 06 Plan 03: Route BuildDispatchService Through planDispatch Core Summary

**BuildDispatchService.dispatch routes GitHub workflow_dispatch through the pure planDispatch core with byte-identical observable behavior — kind discriminator stripped at the impure/pure boundary, all 529 server tests and 13 github-action tests remain green with zero test edits**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-12T02:50:00Z
- **Completed:** 2026-07-12T02:55:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- `buildDispatchService.ts` now calls `planDispatch(service, account.githubInstallationId, repository, buildId, environment, serviceId.toString())` instead of inline `DispatchInput` construction
- `kind` discriminator stripped via `const { kind: _kind, ...input } = plan` before `githubDispatch.dispatch(input)` — preserves exact 7-field shape pinned by characterization test
- All four IO null-checks and exact error strings (`"Account not found"`, `"GitHub App not installed for this account"`, `"Service not found"`, `"Repository not found"`) preserved verbatim
- Full server suite (529 tests, 53 files) and github-action suite (13 tests) green with zero test edits
- PROV-02 success criteria fulfilled: GitHub Actions dispatch runs through `planDispatch`

## Task Commits

1. **Task 1: Route BuildDispatchService.dispatch through planDispatch, strip kind** - `1bdb52b` (refactor)
2. **Task 2: Full-suite regression** - verified inline with Task 1 commit (no separate commit needed; regression was a verification step)

## Files Created/Modified

- `src/services/build/buildDispatchService.ts` - Import `planDispatch` from `../dispatch/planDispatch`; replace inline `DispatchInput` construction with `planDispatch` call; strip `kind` discriminator before forwarding to `githubDispatch.dispatch`

## Decisions Made

- `DispatchInput` import removed from `buildDispatchService.ts` — no longer referenced after planDispatch handles field construction; compiler confirms no unused import
- `ValidationError` branch (`if (plan.kind === "validation-error") throw new Error(plan.reason)`) retained even though it is effectively unreachable in this path (installationId guard runs before planDispatch call) — retained for future non-GitHub callers that may not pre-validate

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 6 complete: pure `planDispatch` core extracted (Plans 01/02) and wired into the production path (Plan 03)
- Phase 9 ready: add `JenkinsPlan` to `DispatchPlan` union in `planDispatch.ts` and route Jenkins dispatch through the same core — `BuildDispatchService` integration pattern already in place
- No blockers

---

_Phase: 06-extract-provider-agnostic-dispatch-core_
_Completed: 2026-07-12_
