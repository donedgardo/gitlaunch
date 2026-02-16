---
phase: 04-trial-payment-lifecycle
plan: 01
subsystem: payments
tags: [mongodb, trial-management, unique-index, tdd]

# Dependency graph
requires:
  - phase: 02-plan-selection-checkout
    provides: Plan enum (Free/Pro/Team) and plan selection flow
  - phase: 01-billing-foundation
    provides: Account type and repository pattern for billing data
provides:
  - TrialRegistryRepository with unique index on githubId for one-trial-per-user enforcement
  - Account.trialEndsAt field for trial expiration tracking
  - TrialService with startTrial and getTrialStatus methods
  - Atomic duplicate prevention via MongoDB unique index
affects: [04-02-trial-ui, 04-03-trial-enforcement, stripe-webhook-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "MongoDB unique index for atomic duplicate detection (code 11000 pattern)"
    - "Injectable clock in services for testable date generation"
    - "Discriminated union return types for operation results (TrialStartResult)"

key-files:
  created:
    - src/repositories/trialRegistryRepository.ts
    - src/repositories/trialRegistryRepository.test.ts
    - src/services/billing/trialService.ts
    - src/services/billing/trialService.test.ts
  modified:
    - src/repositories/accountRepository.ts
    - src/repositories/accountRepository.test.ts

key-decisions:
  - "One trial per GitHub user ID (not per account) - prevents trial abuse across multiple accounts"
  - "MongoDB unique index on githubId - enforces constraint atomically at database level"
  - "Error code 11000 handling - claimTrial returns false on duplicate, not throw"
  - "14-day trial duration - hardcoded constant TRIAL_DURATION_DAYS"
  - "Injectable clock in TrialService - allows deterministic testing of date calculations"
  - "Discriminated unions for result types - type-safe success/failure handling"

patterns-established:
  - "Pattern 1: Unique index repositories return boolean for duplicate detection (true = success, false = duplicate, throw = error)"
  - "Pattern 2: Service methods return discriminated unions for operation results ({ started: true, data } | { started: false, reason })"
  - "Pattern 3: Trial enforcement at GitHub user level, not account level (prevents cross-account abuse)"

# Metrics
duration: 4min
completed: 2026-02-16
---

# Phase 04 Plan 01: Trial Management Core Summary

**TrialRegistry with unique index enforcement, Account.trialEndsAt field, and TrialService coordinating 14-day trial lifecycle**

## Performance

- **Duration:** 4 minutes
- **Started:** 2026-02-16T05:13:48Z
- **Completed:** 2026-02-16T05:17:17Z
- **Tasks:** 6 (TDD red-green cycles)
- **Files modified:** 6

## Accomplishments

- TrialRegistryRepository enforces one trial per GitHub user via MongoDB unique index
- Account schema extended with trialEndsAt field for trial expiration tracking
- TrialService coordinates trial claims with atomic duplicate prevention
- Full TDD coverage with 36 passing tests (7 registry + 19 account + 10 service)

## Task Commits

Each task was committed atomically following TDD red-green cycle:

1. **Task 1: RED - TrialRegistryRepository tests** - `607c906` (test)
2. **Task 2: GREEN - TrialRegistryRepository implementation** - `9388799` (feat)
3. **Task 3: RED - Account trialEndsAt tests** - `909592a` (test)
4. **Task 4: GREEN - Account trialEndsAt implementation** - `58bb0f6` (feat)
5. **Task 5: RED - TrialService tests** - `cf2ffd3` (test)
6. **Task 6: GREEN - TrialService implementation** - `03d5500` (feat)

**Full test suite:** 438 tests pass (no regressions)

## Files Created/Modified

- `src/repositories/trialRegistryRepository.ts` - Collection with unique githubId index, claimTrial returns boolean
- `src/repositories/trialRegistryRepository.test.ts` - Tests duplicate detection across accounts
- `src/repositories/accountRepository.ts` - Added trialEndsAt: Date | null field and setTrialEndsAt method
- `src/repositories/accountRepository.test.ts` - Tests trialEndsAt defaults to null and can be set/cleared
- `src/services/billing/trialService.ts` - Coordinates registry claim + account update with 14-day duration
- `src/services/billing/trialService.test.ts` - Tests trial start validation, duplicate prevention, status computation

## Decisions Made

**One trial per GitHub user ID (not account)** - Prevents trial abuse by creating multiple accounts. Enforced atomically via unique index on githubId.

**Error code 11000 handling** - claimTrial returns false on duplicate key error rather than throwing, allowing service layer to distinguish between "trial already used" (expected) vs database errors (unexpected).

**Injectable clock in TrialService** - Constructor accepts optional `{ now: () => Date }` object for deterministic testing of date calculations, defaulting to `new Date()` in production.

**14-day trial duration** - Hardcoded constant `TRIAL_DURATION_DAYS = 14` based on PROJECT.md requirements. Can be made configurable later if needed.

**Discriminated union return types** - TrialStartResult uses `{ started: true, trialEndsAt } | { started: false, reason }` pattern for type-safe success/failure handling without exceptions.

## Deviations from Plan

None - plan executed exactly as written following TDD methodology.

## Issues Encountered

None - all tests passed on first GREEN attempt.

## User Setup Required

None - no external service configuration required. Trial management uses existing MongoDB database.

## Next Phase Readiness

**Ready for Phase 04 Plan 02:** Trial UI and plan upgrade flows can now use TrialService to check trial status and enforce trial restrictions.

**Ready for Phase 04 Plan 03:** Payment lifecycle webhooks can integrate with TrialService.getTrialStatus to determine if subscription is still in trial period.

**No blockers:** All core trial management infrastructure complete. TrialRegistryRepository ensures GitHub users can only claim one trial. Account.trialEndsAt tracks trial expiration. TrialService provides clean API for trial lifecycle.

## Self-Check: PASSED

All created files exist:

- ✓ src/repositories/trialRegistryRepository.ts (1053 bytes)
- ✓ src/repositories/trialRegistryRepository.test.ts (3834 bytes)
- ✓ src/services/billing/trialService.ts (2211 bytes)
- ✓ src/services/billing/trialService.test.ts (7741 bytes)

All commits exist:

- ✓ 607c906 (test: TrialRegistryRepository)
- ✓ 9388799 (feat: TrialRegistryRepository)
- ✓ 909592a (test: Account trialEndsAt)
- ✓ 58bb0f6 (feat: Account trialEndsAt)
- ✓ cf2ffd3 (test: TrialService)
- ✓ 03d5500 (feat: TrialService)

---

_Phase: 04-trial-payment-lifecycle_
_Completed: 2026-02-16_
