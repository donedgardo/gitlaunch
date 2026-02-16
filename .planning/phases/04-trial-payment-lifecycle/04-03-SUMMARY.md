---
phase: 04-trial-payment-lifecycle
plan: 03
subsystem: billing
tags: [grace-period, payment-failure, ui-warnings, user-retention]
dependency_graph:
  requires: [04-02]
  provides: [grace-period-enforcement, payment-failure-ui]
  affects: [dashboard, billing-settings, plan-enforcement]
tech_stack:
  added: []
  patterns: [grace-period-calculation, banner-priority]
key_files:
  created: []
  modified:
    - src/services/billing/planEnforcementService.ts
    - src/services/billing/planEnforcementService.test.ts
    - src/server/dashboard/index.ts
    - src/server/routes/settings/billing.ts
    - src/templates/dashboard.hbs
    - src/templates/settings/billing.hbs
decisions:
  - decision: 7-day grace period for payment failures
    rationale: Industry standard; balances user retention with revenue protection
    alternatives: [3-day (too aggressive), 14-day (too lenient)]
  - decision: Grace period warning uses red/danger styling
    rationale: More urgent than trial countdown, requires immediate action
    impact: Users prioritize payment updates over other account actions
  - decision: isReadOnly true when payment failed AND grace expired
    rationale: Full access during grace encourages payment; restriction after grace creates urgency
    impact: Users retain functionality while grace is active, restricted after expiry
  - decision: Banner priority - payment failure > trial > read-only
    rationale: Payment issues are most urgent, then trial expiry, then limit overages
    impact: Users see most critical message first
metrics:
  duration_minutes: 4
  tasks_completed: 2
  tests_added: 11
  completed_date: "2026-02-16"
---

# Phase 04 Plan 03: Payment Failure Grace Periods Summary

**One-liner:** 7-day grace period for payment failures with dashboard/billing UI warnings and read-only enforcement after expiry

## What Was Built

Implemented industry-standard grace period handling for payment failures to improve user retention and reduce accidental service interruptions.

**Grace Period Logic (PlanEnforcementService):**

- GRACE_PERIOD_DAYS = 7 constant
- isInGracePeriod(account): returns true if paymentFailedAt within 7 days
- getGracePeriodDaysRemaining(account): computes days remaining (0 if expired)
- getAccountState extended with gracePeriodDaysRemaining and paymentFailed fields
- isReadOnly logic updated: also true when payment failed AND grace expired

**UI Warnings:**

- Dashboard shows red payment failure banner with grace period countdown (highest priority)
- Billing settings page shows payment failure warning with "Update Payment Method" CTA
- Banner priority order: payment failure > trial countdown > read-only
- Grace period warning only displayed when in grace period (has days remaining)

**Read-Only Enforcement Integration:**

- During grace period: full access retained (encourages payment without disruption)
- After grace expires: read-only enforcement kicks in (creates urgency to resolve)
- Integrates seamlessly with existing trial and limit-based read-only logic

## Behavior Verification

**Grace Period Calculation:**

- No paymentFailedAt → isInGracePeriod: false, daysRemaining: 0
- Payment failed 3 days ago → isInGracePeriod: true, daysRemaining: 4
- Payment failed 7 days ago → isInGracePeriod: false, daysRemaining: 0 (grace expired)
- Payment failed 10 days ago → isInGracePeriod: false, isReadOnly: true (if subscribed)

**UI Warning Display:**

- Payment failed 2 days ago → Red banner shows "5 days remaining" with link to billing
- No payment failure → No grace period warning shown
- Grace expired → Warning changes to "access is restricted" (read-only state)

**Read-Only Enforcement:**

- Payment failed + in grace period + Pro plan + 8/10 repos → isReadOnly: false (full access)
- Payment failed + grace expired + Pro plan + 8/10 repos → isReadOnly: true (restricted)
- Payment succeeded → clears paymentFailedAt, restores access (existing webhook logic)

## Test Coverage

**Added 11 tests:**

isInGracePeriod tests (4):

- Returns false when paymentFailedAt is null
- Returns true when paymentFailedAt within 7 days
- Returns false when exactly 7 days ago (boundary)
- Returns false when 10 days ago (expired)

getGracePeriodDaysRemaining tests (3):

- Returns 0 when no payment failure
- Returns 4 days when payment failed 3 days ago
- Returns 0 when grace period expired

getAccountState integration tests (4):

- Returns paymentFailed: false when no failure
- Returns paymentFailed: true and gracePeriodDaysRemaining when in grace
- Returns isReadOnly: false when payment failed but in grace period
- Returns isReadOnly: true when payment failed and grace expired

All existing 32 tests continue to pass.

## Deviations from Plan

None - plan executed exactly as written.

## Files Modified

**Service Layer:**

- `src/services/billing/planEnforcementService.ts` - Added grace period methods and AccountState fields
- `src/services/billing/planEnforcementService.test.ts` - Added 11 tests for grace period logic

**Server Layer:**

- `src/server/dashboard/index.ts` - Pass gracePeriodDaysRemaining and paymentFailed to templates
- `src/server/routes/settings/billing.ts` - Fetch accountState and pass grace period data

**Template Layer:**

- `src/templates/dashboard.hbs` - Added payment failure banner with priority ordering
- `src/templates/settings/billing.hbs` - Added payment failure warning section with CTA

## Integration Points

**Webhook Integration (already exists from 04-01/04-02):**

- invoice.payment_failed webhook sets account.paymentFailedAt
- invoice.payment_succeeded webhook clears account.paymentFailedAt
- Grace period logic automatically applies based on paymentFailedAt timestamp

**Enforcement Integration:**

- getAccountState checks grace period before setting isReadOnly
- Dashboard and billing routes use getAccountState for consistent state
- Read-only enforcement (from 04-02) kicks in after grace expires

**UI Integration:**

- Dashboard shows most urgent banner first (payment > trial > read-only)
- Billing settings provides direct path to Stripe Customer Portal for payment updates
- Grace period countdown creates urgency without immediate service disruption

## Next Steps

This completes Phase 04 - Trial & Payment Lifecycle. All payment lifecycle features are now integrated:

- Trial management with 14-day duration (04-01)
- Trial UI with countdown and auto-downgrade (04-02)
- Payment failure grace periods with UI warnings (04-03)

The billing system now provides a complete user retention flow:

1. New users start with 14-day trial on Pro/Team plans
2. Trial countdown shows urgency to subscribe
3. Payment failures trigger 7-day grace period
4. Grace period warnings encourage payment updates
5. Post-grace read-only enforcement creates strong incentive to resolve

**Phase 4 Status:** COMPLETE (3/3 plans)

## Self-Check

Verifying SUMMARY claims:

**Files exist:**

```bash
# Modified files
ls -la src/services/billing/planEnforcementService.ts
ls -la src/services/billing/planEnforcementService.test.ts
ls -la src/server/dashboard/index.ts
ls -la src/server/routes/settings/billing.ts
ls -la src/templates/dashboard.hbs
ls -la src/templates/settings/billing.hbs
```

**Commits exist:**

```bash
git log --oneline | grep -E "(8aead3c|5708a56)"
```

**Tests pass:**

```bash
yarn test src/services/billing/planEnforcementService.test.ts
```

## Self-Check: PASSED

**Files exist:** ✓

- src/services/billing/planEnforcementService.ts (9068 bytes)
- src/services/billing/planEnforcementService.test.ts (38355 bytes)
- src/server/dashboard/index.ts (13148 bytes)
- src/server/routes/settings/billing.ts (6628 bytes)
- src/templates/dashboard.hbs (2417 bytes)
- src/templates/settings/billing.hbs (5235 bytes)

**Commits exist:** ✓

- 8aead3c feat(04-03): implement grace period logic in PlanEnforcementService
- 5708a56 feat(04-03): add payment failure grace period UI warnings

**Tests pass:** ✓

- Test Files: 1 passed (1)
- Tests: 43 passed (43)
