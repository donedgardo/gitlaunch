---
phase: 02-plan-selection-checkout
plan: 01
subsystem: payments
tags: [stripe, billing, plan-model, three-tier, enum-expansion]

# Dependency graph
requires:
  - phase: 01-billing-foundation
    provides: AccountRepository with Plan enum, MembershipService interface, StripeService, WebhookHandler
provides:
  - Three-tier Plan enum (Free/Pro/Team) replacing binary Free/Paid
  - Per-tier limit constants: Free (3/3/1/public), Pro (10/10/5/private), Team (999/999/999/private)
  - upgradeToPlan method replacing upgradeToPaid with plan parameter
  - selectPlan method for setting plan without Stripe IDs
  - Plan-aware MembershipService/StripeService with plan parameter
  - Plan-aware webhook processing with metadata.plan
affects:
  [
    02-plan-selection-checkout-02,
    02-plan-selection-checkout-03,
    03-plan-enforcement,
    04-trial-lifecycle,
  ]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Plan enum as three-tier model (not binary)"
    - "PLAN_LIMITS_MAP for plan-to-limits mapping"
    - "upgradeToPlan with plan parameter for Stripe subscription upgrades"
    - "selectPlan for plan selection without Stripe IDs"
    - "Plan metadata in Stripe checkout sessions"

key-files:
  created: []
  modified:
    - src/repositories/accountRepository.ts
    - src/services/billing/membershipService.ts
    - src/services/billing/stripeService.ts
    - src/services/billing/webhookHandler.ts
    - src/server/routes/webhooks/stripe.ts

key-decisions:
  - "Plan enum has three tiers (Free/Pro/Team) not binary - supports pricing flexibility"
  - "upgradeToPlan rejects Free - cannot 'upgrade' to Free, use downgradeToFree instead"
  - "selectPlan allows all tiers including Free - for plan selection without payment"
  - "Free plan limits: 3 repos, 3 services (from 1/1) - more generous trial"
  - "Pro plan limits: 10/10/5 - mid-tier for small teams"
  - "Team plan limits: 999/999/999 - effectively unlimited"
  - "Webhook defaults to Pro if plan missing - backward compatibility for legacy sessions"

patterns-established:
  - "PLAN_LIMITS_MAP pattern: Record<Plan, PlanLimits> for centralized limit lookup"
  - "getPriceIdForPlan pattern: plan-to-priceId mapping in StripeService"
  - "Plan in checkout metadata pattern: session.metadata.plan passed through webhook"

# Metrics
duration: 14min
completed: 2026-02-10
---

# Phase 2 Plan 1: Three-Tier Plan Model Summary

**Plan enum expanded from binary Free/Paid to three-tier Free/Pro/Team with per-tier limits, plan-aware billing services, and checkout metadata propagation**

## Performance

- **Duration:** 14 min
- **Started:** 2026-02-10T22:31:13Z
- **Completed:** 2026-02-10T22:45:30Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 15

## Accomplishments

- Plan enum supports Free, Pro, and Team tiers with distinct limit constants
- AccountRepository methods (upgradeToPlan, selectPlan) handle all three tiers correctly
- Billing service layer (MembershipService, StripeService, WebhookHandler) fully plan-aware
- Checkout sessions include plan in metadata, webhooks process it correctly
- All existing tests updated to new three-tier model
- Free plan limit increased to 3 repos/3 services (from 1/1) for better trial experience

## Task Commits

Each task was committed atomically following TDD:

1. **Task 1: Expand Plan enum and AccountRepository** - `bab6ae2` (feat)

   - RED: Tests for Plan.Pro, Plan.Team, per-tier limits, upgradeToPlan, selectPlan
   - GREEN: Implemented three-tier enum, limit constants, PLAN_LIMITS_MAP, new methods
   - Updated existing tests for new Free limits (3/3/1)

2. **Task 2: Make billing service layer plan-aware** - `94449c5` (feat)
   - RED: Tests for plan parameter in MembershipService, teamPriceId in config, plan metadata
   - GREEN: Added plan parameter to interfaces, getPriceIdForPlan method, metadata propagation
   - Updated all test files (billing, webhook routes, enforcement, onboarding, repository)

## Files Created/Modified

### Core Repository Layer

- `src/repositories/accountRepository.ts` - Plan enum (Free/Pro/Team), limit constants, upgradeToPlan, selectPlan methods
- `src/repositories/accountRepository.test.ts` - Comprehensive tests for three-tier model

### Billing Service Layer

- `src/services/billing/membershipService.ts` - Added plan parameter to createCheckoutSession interface
- `src/services/billing/stripeService.ts` - teamPriceId config, getPriceIdForPlan method, plan in metadata
- `src/services/billing/stripeService.test.ts` - Tests for plan-aware checkout session creation
- `src/services/billing/webhookHandler.ts` - CheckoutCompletedEvent with plan field, calls upgradeToPlan
- `src/services/billing/webhookHandler.test.ts` - Tests for plan-specific upgrades
- `src/services/billing/planEnforcementService.test.ts` - Updated for new tier limits

### Route Layer

- `src/server/routes/webhooks/stripe.ts` - Passes plan from session.metadata (defaults to "pro")
- `src/server/routes/webhooks/stripe.test.ts` - Tests for plan propagation from metadata
- `src/server/routes/settings/billing.ts` - Defaults to Plan.Pro for backward compatibility
- `src/server/routes/settings/billing.test.ts` - Updated config with teamPriceId
- `src/server/routes/onboarding/index.test.ts` - Updated for 3-repo Free limit

### Repository Service

- `src/services/repository/repositoryService.test.ts` - Updated for 3-repo Free limit

## Decisions Made

**Plan enum as three tiers (not binary):**

- Supports flexible pricing strategy with mid-tier Pro plan
- Team plan allows scaling to enterprise needs
- Clean migration path: Paid -> Pro (backward compatible)

**Free plan limits increased (3 repos/3 services):**

- More generous trial allows meaningful evaluation
- Still constrains resource usage for free tier
- Aligns with PROJECT.md requirement "Free: 3 repos / 3 services"

**selectPlan vs upgradeToPlan distinction:**

- selectPlan: Sets plan and limits WITHOUT Stripe IDs (for plan picker UI)
- upgradeToPlan: Sets plan, limits, AND Stripe IDs (for paid subscription)
- upgradeToPlan rejects Free (cannot "upgrade" to Free - use downgradeToFree)
- selectPlan accepts all plans including Free (for plan selection flow)

**Webhook defaults to Pro for legacy:**

- session.metadata.plan || "pro" provides backward compatibility
- Legacy checkout sessions without plan metadata still work
- New sessions will always include plan explicitly

## Deviations from Plan

None - plan executed exactly as written. All changes were explicitly specified in the plan tasks.

## Issues Encountered

**Test suite required extensive updates:**

- All references to Plan.Paid → Plan.Pro throughout codebase
- All calls to upgradeToPaid → upgradeToPlan with Plan parameter
- All test expectations updated for new Free limits (1 repo → 3 repos, 1 service → 3 services)
- Error messages in tests updated to match actual rendered text
- Handled gracefully by updating tests systematically

**TypeScript compilation errors after test changes:**

- Missing plan parameter in createCheckoutSession calls
- Missing teamPriceId in StripeServiceConfig
- Fixed by adding default Plan.Pro in production route (billing.ts)
- Fixed by adding teamPriceId to all test configs
- Fixed by adding plan parameter to all test createCheckoutSession calls

## User Setup Required

None - no external service configuration required. This phase only modified internal plan model and service layer.

## Next Phase Readiness

**Phase 2 Plan 2 (Plan Picker UI) is ready:**

- Plan enum supports Free, Pro, Team
- selectPlan method available for plan selection without payment
- planLimits available for displaying feature differences
- No blockers

**Phase 2 Plan 3 (Checkout Flow) is ready:**

- StripeService.createCheckoutSession accepts plan parameter
- getPriceIdForPlan maps plan to correct Stripe price ID
- Checkout session metadata includes plan
- Webhook processes plan correctly
- No blockers

**Phase 3 (Plan Enforcement) is ready:**

- PlanEnforcementService already uses planLimits from account
- Tests updated to new per-tier limits
- No code changes needed in enforcement layer
- No blockers

---

_Phase: 02-plan-selection-checkout_
_Plan: 01_
_Completed: 2026-02-10_
