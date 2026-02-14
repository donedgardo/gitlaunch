---
phase: 03-plan-enforcement-limits
plan: 02
subsystem: billing
tags: [billing, plan-limits, environments, enforcement, API]

requires:
  - phase: 03-01
    provides: canAddEnvironment method in PlanEnforcementService
provides:
  - Environment limit enforcement in HTMX settings route
  - Environment limit enforcement in API route with 403 responses
  - Upgrade CTAs when environment limit is hit
  - Behavior tests for environment limit enforcement in API
affects: [04-trial-payment-lifecycle]

tech-stack:
  added: []
  patterns:
    [Dependency injection for enforcement service, behavior-driven testing]

key-files:
  created: []
  modified:
    - src/server/routes/services/settings.ts
    - src/server/routes/api/environments.ts
    - src/server/routes/api/environments.test.ts
    - src/server/createAppServer.ts
    - src/server/routes/services/settings.test.ts
    - src/services/billing/membershipService.test.ts
    - src/services/billing/stripeService.test.ts

key-decisions:
  - "PlanEnforcementService injected into route handlers via dependency injection"
  - "403 status code for plan limit violations (forbidden, not bad request)"
  - "HTMX route returns error partial with upgrade message for limit violations"
  - "API route returns JSON with upgradeRequired flag for limit violations"
  - "Existing tests upgraded to Pro plan to avoid hitting Free plan environment limit"

duration: 5 min
completed: 2026-02-14
---

# Phase 3 Plan 02: Wire Enforcement into Endpoints Summary

**Environment creation endpoints now enforce plan limits: Free plan users blocked at 2 environments (staging + prod), Pro/Team can add more, with upgrade CTAs in all error responses.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-14T15:01:35Z
- **Completed:** 2026-02-14T15:06:46Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Added `planEnforcementService` dependency to `SettingsRoutesDeps` and `EnvironmentsRoutesDependencies`
- Environment creation in HTMX route (`POST /services/:serviceId/environments`) checks `canAddEnvironment` before creating
- Environment creation in API route (`POST /api/v1/services/:serviceId/environments`) checks `canAddEnvironment` before creating
- HTMX route returns error partial with upgrade message when limit hit
- API route returns 403 with `{ error, upgradeRequired }` JSON when limit hit
- Wired `planEnforcementService` into both route registrations in `createAppServer.ts`
- Added 3 new behavior tests proving Free plan enforcement and Pro plan capacity
- Fixed existing tests by upgrading to Pro plan to avoid hitting Free plan limits
- Fixed mock accounts in other test files to include `maxEnvironments` field

## Task Commits

1. **Task 1: Wire enforcement into endpoints** - `eaa8d2c` (feat)
   - Added planEnforcementService to route dependencies
   - Check canAddEnvironment before creating environment in both routes
   - Wire planEnforcementService in createAppServer
   - Update all test files with new dependencies and maxEnvironments field
2. **Task 2: Add behavior tests** - `ffc3538` (test)
   - Test: Free plan cannot add environments beyond limit (403)
   - Test: Pro plan can add environments within limit (201)
   - Test: Error response includes upgradeRequired flag and upgrade message
   - Fix: Existing tests upgrade to Pro plan to allow environment creation

## Files Created/Modified

- `src/server/routes/services/settings.ts` - Added canAddEnvironment check before environmentService.addEnvironment in HTMX route
- `src/server/routes/api/environments.ts` - Added canAddEnvironment check before environmentService.addEnvironment in API route, returns 403 with upgrade info
- `src/server/routes/api/environments.test.ts` - Added 3 new tests for limit enforcement, fixed 3 existing tests to use Pro plan
- `src/server/createAppServer.ts` - Wire planEnforcementService into registerSettingsRoutes and registerEnvironmentsRoutes
- `src/server/routes/services/settings.test.ts` - Added planEnforcementService and membershipRepo to test setup
- `src/services/billing/membershipService.test.ts` - Added maxEnvironments to mock account planLimits
- `src/services/billing/stripeService.test.ts` - Added maxEnvironments to mock account planLimits

## Decisions Made

**PlanEnforcementService dependency injection:** Both route handlers receive planEnforcementService via their dependencies object, following existing pattern in codebase.

**403 status code for plan limits:** Used 403 (Forbidden) instead of 400 (Bad Request) because plan limits are authorization constraints, not input validation errors.

**Dual response patterns for HTMX vs API:** HTMX route returns error partial (200 status with error message in template) for HTMX swap behavior. API route returns 403 with JSON for programmatic clients.

**upgradeRequired flag in API responses:** API responses include `upgradeRequired: true` flag to enable client-side upgrade flow detection.

**Test fixes as deviation:** Existing tests broke because Free plan accounts now correctly enforce 2-environment limit. Fixed by upgrading test accounts to Pro plan (Rule 1: Auto-fix bugs).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing planEnforcementService in test files**

- **Found during:** Task 1 - TypeScript compilation
- **Issue:** Test files for settings.test.ts and environments.test.ts failed to compile because they didn't provide planEnforcementService to route registrations
- **Fix:** Added PlanEnforcementService and MembershipRepository to test setup in both files
- **Files modified:** settings.test.ts, environments.test.ts
- **Commit:** eaa8d2c (included in Task 1)

**2. [Rule 3 - Blocking] Missing maxEnvironments in mock accounts**

- **Found during:** Task 1 - TypeScript compilation
- **Issue:** membershipService.test.ts and stripeService.test.ts had mock Account objects missing the new maxEnvironments field in planLimits
- **Fix:** Added `maxEnvironments: 2` to planLimits in mock accounts
- **Files modified:** membershipService.test.ts, stripeService.test.ts
- **Commit:** eaa8d2c (included in Task 1)

**3. [Rule 1 - Bug] Existing tests failing due to environment limit enforcement**

- **Found during:** Task 2 - Running environment API tests
- **Issue:** Three existing tests ("should add a new environment", "should return 400 for invalid name format", "should return 400 for duplicate name") failed with 403 status because Free plan accounts (the default) already have 2 environments and cannot add more
- **Fix:** Upgraded test accounts to Pro plan using `accountRepo.selectPlan(testAccountId, Plan.Pro)` before attempting to add environments
- **Files modified:** environments.test.ts
- **Commit:** ffc3538 (Task 2)

## Issues Encountered

None. All deviations were handled automatically under Rule 1 (bug fixes) and Rule 3 (blocking issues). No architectural decisions required.

## Next Phase Readiness

**Phase 3 COMPLETE:** All environment creation endpoints now enforce plan limits. PlanEnforcementService covers all resource types:

- Repositories (account-level)
- Services (account-level)
- Users (account-level)
- Environments (service-level)

**Ready for Phase 4:** Trial & Payment Lifecycle (3 plans)

- Trial management with 14-day countdown
- Auto-downgrade on trial expiry
- Payment failure handling with grace periods

Environment limit enforcement is fully operational. Users on Free plan are blocked at 2 environments with clear upgrade messaging. Pro/Team users can add up to their tier limits. All tests pass (417/417).

## Self-Check: PASSED

All modified files exist:

- src/server/routes/services/settings.ts
- src/server/routes/api/environments.ts
- src/server/routes/api/environments.test.ts
- src/server/createAppServer.ts
- src/server/routes/services/settings.test.ts
- src/services/billing/membershipService.test.ts
- src/services/billing/stripeService.test.ts

All commits exist:

- eaa8d2c (feat: Task 1 - wire enforcement into endpoints)
- ffc3538 (test: Task 2 - add behavior tests)

All tests pass: 417/417 tests, including 3 new environment limit tests
