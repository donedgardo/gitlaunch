---
phase: 03-plan-enforcement-limits
plan: 03
subsystem: plan-enforcement

tags:
  - plan-enforcement
  - repository-limits
  - batch-limit-check
  - gap-closure
  - tdd

requires:
  - phase: 03-plan-enforcement-limits
    provides: PlanEnforcementService with canAddPrivateRepository method

provides:
  - Repository onboarding with correct batch limit enforcement (existing + new repos)
  - Private repository blocking via canAddPrivateRepository method call
  - Fixed gap where free plan users could bypass repo limits by batch submission

affects:
  - Future repository creation flows that need batch limit checks

tech-stack:
  added: []
  patterns:
    - Batch limit check pattern (current + new > limit) for multi-item operations
    - Service method delegation for private repo enforcement

key-files:
  created: []
  modified:
    - src/server/routes/onboarding/index.ts
    - src/server/routes/onboarding/index.test.ts

key-decisions:
  - "Batch limit check uses getUsage() not canAddRepository() - getUsage returns {current, limit} enabling correct math for N-item operations"
  - "canAddPrivateRepository replaces inline boolean check - consistent with service layer patterns"
  - "Error message format matches PlanEnforcementService patterns - Repository limit reached (X/Y)"

duration: 2min
completed: 2026-02-15
---

# Phase 3 Plan 03: Repository Limit Gap Closure Summary

**Fixed critical batch limit bypass where free plan users with existing repos could exceed limits by selecting multiple new repos in onboarding flow.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-16T01:41:01Z
- **Completed:** 2026-02-16T01:43:14Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Fixed batch repo limit enforcement to account for existing repositories (current + new > limit)
- Wired canAddPrivateRepository service method into repository creation endpoint
- Prevented free plan users from bypassing 3-repo limit via batch submission
- Error messages now consistent with PlanEnforcementService patterns used in environment/service enforcement
- All tests passing (418 total) with no regressions

## Task Commits

1. **Task 1 (RED):** Add failing test for existing+new repo limit check - `dad377f` (test)

   - Proved current implementation only checks batch size, not existing repos
   - Free user with 2 existing + 2 new (4 total) incorrectly passes through

2. **Task 2 (GREEN):** Wire canAddPrivateRepository and fix batch repo limit check - `20034df` (feat)
   - Changed limit check from `selectedRepos.length > limit` to `current + selectedRepos.length > limit`
   - Replaced inline `!usage.privateReposAllowed` check with `canAddPrivateRepository()` call
   - Updated error message format to match service layer patterns

## Files Created/Modified

- `src/server/routes/onboarding/index.ts` - Fixed batch repo limit check (line 242: current + new > limit), wired canAddPrivateRepository (line 262)
- `src/server/routes/onboarding/index.test.ts` - Added test for existing+new repo scenario, updated error message assertions

## Decisions Made

**Why getUsage() for batch checks instead of canAddRepository()?**

- `canAddRepository()` answers "can I add 1 more?" (single-item check)
- Batch operations need "can I add N more?"
- `getUsage()` returns `{current, limit}` enabling correct math: `current + N > limit`

**Why wire canAddPrivateRepository instead of inline boolean check?**

- Consistent with service layer patterns (environment/service enforcement use service methods)
- Centralizes private repo logic in PlanEnforcementService
- Error messages come from single source of truth

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

**Test assertion update required:** Existing test expected old error message format "Your free plan allows up to 3 repository" but implementation now uses PlanEnforcementService pattern "Repository limit reached (0/3). Upgrade to add more repositories." This is an improvement (consistency) not a deviation - updated test to match new format.

## Next Phase Readiness

**Phase 3 Complete:** All plan enforcement gaps closed. Repository, service, environment, and user limits properly enforced at all creation endpoints. System ready for Phase 4: Trial & Payment Lifecycle.

**Verification:**

- `grep -n "canAddPrivateRepository" src/server/routes/onboarding/index.ts` → Line 262 confirmed
- `grep -n "repositories.current" src/server/routes/onboarding/index.ts` → Lines 242, 244 confirmed
- All 418 tests passing, no regressions

## Self-Check: PASSED

**Files modified:**

- FOUND: src/server/routes/onboarding/index.ts
- FOUND: src/server/routes/onboarding/index.test.ts

**Commits:**

- FOUND: dad377f
- FOUND: 20034df

**Verification commands:**

- canAddPrivateRepository called: YES (line 262)
- repositories.current used: YES (lines 242, 244)
- All tests pass: YES (418/418)
