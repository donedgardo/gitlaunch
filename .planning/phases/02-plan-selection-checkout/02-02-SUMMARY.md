---
phase: 02-plan-selection-checkout
plan: 02
subsystem: ui
tags: [onboarding, plan-selection, handlebars, tailwind]

# Dependency graph
requires:
  - phase: 02-01
    provides: Three-tier plan model (Free/Pro/Team) with selectPlan method
provides:
  - Plan selection UI in onboarding flow with Free/Pro/Team cards
  - /onboarding/plan-selection GET route with auth guard
  - /onboarding/select-plan POST route saving plan choice
  - Updated auth flow redirecting new users to plan selection first
affects: [02-03, checkout-flow, onboarding-experience]

# Tech tracking
tech-stack:
  added: []
  patterns:
    [
      plan-selection-before-github-app,
      standard-html-form-post,
      pro-card-highlighting,
    ]

key-files:
  created:
    - src/templates/onboarding/plan-selection.hbs
  modified:
    - src/server/routes/onboarding/index.ts
    - src/server/routes/auth/github.ts
    - src/server/testing/mockViewPlugin.ts

key-decisions:
  - "Plan selection happens before GitHub App install - intentional commitment moment"
  - "Pro card highlighted with blue background and 'Most Popular' badge for conversion"
  - "Returning users with non-Free plan skip plan selection page"
  - "Standard HTML form POST (not HTMX) for plan selection - full page navigation step"

patterns-established:
  - "Plan picker shows exact pricing: Free $0, Pro $19/mo, Team $49/mo"
  - "Plan limits displayed in feature lists: repositories, services, team members"
  - "3-column responsive grid (1-col mobile, 3-col desktop)"

# Metrics
duration: 3min
completed: 2026-02-10
---

# Phase 2 Plan 2: Plan Selection in Onboarding Summary

**Plan picker with Free/Pro/Team cards integrated into onboarding flow before GitHub App installation**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-11T02:48:02Z
- **Completed:** 2026-02-11T02:51:09Z
- **Tasks:** 1
- **Files modified:** 6

## Accomplishments

- Plan selection template with 3-column responsive grid showing Free ($0), Pro ($19), Team ($49)
- New users redirected to plan selection after signup, before GitHub App install
- Pro card visually highlighted as "Most Popular" with blue background for conversion
- All three plans show correct limits (repositories, services, team members)

## Task Commits

Each task was committed atomically:

1. **Task 1: Plan selection route and template in onboarding flow** - `4d493a1` (feat)

## Files Created/Modified

- `src/templates/onboarding/plan-selection.hbs` - Plan comparison UI with Free/Pro/Team cards
- `src/server/routes/onboarding/index.ts` - Added GET /onboarding/plan-selection and POST /onboarding/select-plan routes
- `src/server/routes/auth/github.ts` - Updated new user redirect to /onboarding/plan-selection
- `src/server/routes/onboarding/index.test.ts` - Tests for plan selection rendering and plan setting
- `src/server/routes/auth/github.test.ts` - Updated test expecting new users to go to plan selection
- `src/server/testing/mockViewPlugin.ts` - Added plan-selection template support for tests

## Decisions Made

**Plan selection before GitHub App install:** Intentional decision to have users commit to a plan tier before proceeding to GitHub integration. This creates commitment and ensures correct limits from the start.

**Pro card highlighted:** Visual prominence via blue background and "Most Popular" badge to guide users toward paid tier (conversion optimization).

**Returning users skip plan selection:** If account already has non-Free plan set, redirect straight to /onboarding (GitHub App install). Avoids forcing returning users through plan picker again.

**Standard HTML form POST:** Used standard form submission (not HTMX) since plan selection is a full-page navigation step in onboarding flow, matching pattern of other onboarding steps.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - implementation was straightforward. Template followed existing onboarding patterns, routes integrated cleanly with auth flow.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan selection UI complete and tested. Ready for Phase 2 Plan 3 (Checkout Flow) which will:

- Add "Upgrade to Pro" / "Upgrade to Team" checkout buttons
- Integrate Stripe Checkout session creation
- Handle post-checkout subscription activation

Plan selection establishes the foundation - users choose their tier, checkout flow will handle payment collection for Pro/Team choices.

## Self-Check: PASSED

All claimed files exist and commits are present in git history.

- FOUND: src/templates/onboarding/plan-selection.hbs
- FOUND: 4d493a1

---

_Phase: 02-plan-selection-checkout_
_Completed: 2026-02-10_
