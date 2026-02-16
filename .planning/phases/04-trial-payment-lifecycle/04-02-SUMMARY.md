---
phase: 04-trial-payment-lifecycle
plan: "02"
subsystem: trial-lifecycle
tags: [trial, auto-downgrade, read-only-state, ui-integration]
completed: 2026-02-16
duration: 7min

# Dependency Graph
requires: ["04-01"]
provides:
  ["trial-countdown-ui", "trial-expiry-auto-downgrade", "read-only-enforcement"]
affects: ["onboarding", "dashboard", "plan-enforcement"]

# Tech Stack
tech_added: []
tech_patterns:
  - "Discriminated union result types for trial expiry (TrialExpiryResult)"
  - "Derived state computation (isReadOnly from usage vs limits)"
  - "Auto-downgrade on dashboard load (checkAndHandleTrialExpiry)"
  - "Conditional Handlebars banners (trialDaysRemaining, isReadOnly)"

# Key Files
files_created: []
files_modified:
  - src/services/billing/trialService.ts
  - src/services/billing/trialService.test.ts
  - src/services/billing/planEnforcementService.ts
  - src/services/billing/planEnforcementService.test.ts
  - src/repositories/accountRepository.ts
  - src/repositories/accountRepository.test.ts
  - src/server/routes/onboarding/index.ts
  - src/server/routes/onboarding/index.test.ts
  - src/server/dashboard/index.ts
  - src/server/dashboard/index.test.ts
  - src/server/createAppServer.ts
  - src/templates/dashboard.hbs

# Decisions
decisions:
  - decision: "Math.ceil for trial days remaining in getAccountState"
    rationale: "Shows 1 day remaining on last partial day (user-friendly, creates urgency)"
    alternatives: "Math.floor would show 0 days on last day (more accurate but less clear)"
  - decision: "isReadOnly derived from current usage vs limits (not stored)"
    rationale: "Always up-to-date with current state, no sync issues, simpler data model"
    alternatives: "Store isReadOnly flag (requires updates on every resource change)"
  - decision: "checkAndHandleTrialExpiry on every dashboard load"
    rationale: "Ensures trial expiry is handled promptly without cron jobs or background tasks"
    alternatives: "Background task (more complex infrastructure, delayed downgrade)"
  - decision: "upgradeToPlan clears trialEndsAt"
    rationale: "Subscribed users shouldn't see trial countdown (they're paying)"
    alternatives: "Keep trialEndsAt (confusing UI state)"
---

# Phase 04 Plan 02: Trial wiring, auto-downgrade, read-only enforcement, and countdown UI

**One-liner:** Trial flow integrated end-to-end: plan selection starts trial, dashboard shows countdown, expiry triggers auto-downgrade, over-limit resources become read-only.

## Overview

Completed integration of trial lifecycle into onboarding and dashboard. Users selecting paid plans now start 14-day trials. Dashboard displays trial countdown and auto-downgrades expired trials to Free. Accounts exceeding Free plan limits after downgrade show read-only banners.

## Deviations from Plan

None - plan executed exactly as written.

## Implementation Summary

### Task 1: TrialService expiry + PlanEnforcementService getAccountState (TDD)

**Commits:**

- `543d635`: feat(04-02): implement checkAndHandleTrialExpiry for auto-downgrade
- `22c2928`: feat(04-02): clear trialEndsAt when upgrading to paid plan
- `221cb6e`: feat(04-02): add getAccountState for read-only state computation

**What was built:**

1. **checkAndHandleTrialExpiry in TrialService:**

   - Returns `{ expired: false }` when no trial or trial active
   - Returns `{ expired: true, downgraded: true }` when trial expired with no subscription
   - Calls `accountRepo.downgradeToFree` and clears `trialEndsAt`
   - Returns `{ expired: false }` when trial expired BUT subscription exists (clears stale `trialEndsAt`)

2. **AccountRepository.upgradeToPlan updated:**

   - Now sets `trialEndsAt: null` when upgrading (subscription clears trial state)
   - Prevents showing countdown to paying customers

3. **PlanEnforcementService.getAccountState:**
   - Computes `isReadOnly` as derived state: `repos.current > repos.limit || services.current > services.limit`
   - Computes `trialDaysRemaining` from `account.trialEndsAt` using `Math.ceil` (shows 1 day on last partial day)
   - Returns complete account state for UI rendering

**Files modified:**

- `src/services/billing/trialService.ts` (+33 lines)
- `src/services/billing/trialService.test.ts` (+84 lines)
- `src/repositories/accountRepository.ts` (+1 line)
- `src/repositories/accountRepository.test.ts` (+21 lines)
- `src/services/billing/planEnforcementService.ts` (+37 lines)
- `src/services/billing/planEnforcementService.test.ts` (+161 lines)

### Task 2: Wire into onboarding + dashboard + UI

**Commit:**

- `38be1fe`: feat(04-02): wire trial flow into onboarding and dashboard

**What was built:**

1. **Onboarding route integration:**

   - POST `/onboarding/select-plan` now:
     - Looks up user by `session.userId` to get `githubId`
     - Calls `trialService.startTrial` for Pro/Team plans
     - Always calls `accountRepo.selectPlan` (respects user choice even if trial already used)
   - Updated `OnboardingRoutesDeps` to include `userRepository` and `trialService`

2. **Dashboard route integration:**

   - Both dashboard handlers (`/dashboard` and `/dashboard/:serviceName`) now:
     - Call `trialService.checkAndHandleTrialExpiry(accountId)` before rendering
     - Call `planEnforcementService.getAccountState(accountId)` to get trial/read-only state
     - Pass `trialDaysRemaining` and `isReadOnly` to template
   - Updated `DashboardRoutesDeps` to include `trialService` and `planEnforcementService`

3. **Dashboard template UI:**

   - Added trial countdown banner (yellow, warning style):
     - Shows "Trial: X days remaining. Subscribe to keep your plan."
     - Links to `/settings/billing`
     - Only displayed when `trialDaysRemaining > 0`
   - Added read-only banner (red, alert style):
     - Shows "Your account exceeds Free plan limits. Resources are read-only. Upgrade to restore full access."
     - Links to `/settings/billing`
     - Only displayed when `isReadOnly` is true

4. **Server wiring:**

   - Added `TrialRegistryRepository` initialization in `createAppServer`
   - Added `TrialService` initialization with `accountRepo` and `trialRegistryRepo`
   - Wired `trialService` into onboarding and dashboard route registrations
   - Wired `planEnforcementService` into dashboard route registration

5. **Test updates:**
   - Updated `onboarding/index.test.ts`: added `userRepository` and `trialService`, created users for Pro/Team plan tests
   - Updated `dashboard/index.test.ts`: added `accountRepo`, `membershipRepo`, `trialRegistryRepo`, `planEnforcementService`, `trialService`, created accounts for all tests

**Files modified:**

- `src/server/routes/onboarding/index.ts` (+29 lines)
- `src/server/routes/onboarding/index.test.ts` (+24 lines)
- `src/server/dashboard/index.ts` (+24 lines)
- `src/server/dashboard/index.test.ts` (+66 lines)
- `src/server/createAppServer.ts` (+12 lines)
- `src/templates/dashboard.hbs` (+32 lines)

## Verification

```bash
yarn test
```

**Result:** All 449 tests pass.

**Manual verification flow:**

1. User selects Pro plan in onboarding → trial starts (14 days)
2. Dashboard shows yellow banner: "Trial: 14 days remaining"
3. Trial expires → dashboard auto-downgrades to Free, clears `trialEndsAt`
4. If downgraded account has 5 repos (over Free limit of 3) → dashboard shows red "read-only" banner
5. User subscribes via Stripe → `upgradeToPlan` clears `trialEndsAt`, no countdown shown

## What This Unlocks

**For Phase 4 completion:**

- Trial UI and flow complete (plan 04-02 ✓)
- Ready for plan 04-03: Payment lifecycle webhooks (subscription.updated, subscription.deleted)

**For users:**

- Clear trial countdown creates urgency to subscribe
- Auto-downgrade is automatic (no manual intervention needed)
- Over-limit resources remain visible (not deleted) but read-only
- Subscribed users never see trial countdown (better UX)

## Next Steps

Plan 04-03 will implement:

- Stripe webhook handler for `customer.subscription.updated` (plan changes)
- Stripe webhook handler for `customer.subscription.deleted` (cancellations)
- Downgrade to Free when subscription cancelled
- Handle payment failures with grace period

## Success Criteria

- [x] Selecting a paid plan in onboarding starts a 14-day trial
- [x] Dashboard loads trigger trial expiry check and auto-downgrade
- [x] Trial countdown banner appears on dashboard when on trial
- [x] Read-only banner appears when account is over Free plan limits
- [x] upgradeToPlan clears trialEndsAt (subscribed users don't see countdown)
- [x] getAccountState correctly computes isReadOnly from usage vs limits
- [x] `yarn test` passes with no errors

## Self-Check: PASSED

**Created files:** None (all modifications)

**Modified files verified:**

- [x] src/services/billing/trialService.ts - checkAndHandleTrialExpiry method exists
- [x] src/services/billing/planEnforcementService.ts - getAccountState method exists
- [x] src/repositories/accountRepository.ts - upgradeToPlan sets trialEndsAt: null
- [x] src/server/routes/onboarding/index.ts - calls trialService.startTrial for paid plans
- [x] src/server/dashboard/index.ts - calls checkAndHandleTrialExpiry on load
- [x] src/templates/dashboard.hbs - contains trial countdown banner
- [x] src/server/createAppServer.ts - trialService wired into dependencies

**Commits verified:**

- [x] 543d635 - checkAndHandleTrialExpiry implementation
- [x] 22c2928 - upgradeToPlan clears trialEndsAt
- [x] 221cb6e - getAccountState implementation
- [x] 38be1fe - onboarding and dashboard wiring

All files exist, all commits present, all tests passing.
