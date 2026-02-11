---
phase: 02-plan-selection-checkout
plan: 03
subsystem: payments
tags:
  [
    billing-ui,
    stripe-integration,
    checkout-flow,
    htmx-redirect,
    plan-aware,
    server-wiring,
  ]

# Dependency graph
requires:
  - phase: 02-plan-selection-checkout-01
    provides: Three-tier Plan enum, plan-aware MembershipService/StripeService
  - phase: 02-plan-selection-checkout-02
    provides: Plan selection UI
provides:
  - Billing settings page (GET /settings/billing) with current plan and usage display
  - Plan-aware checkout route (POST /api/billing/checkout) with pro/team validation
  - HX-Redirect header support for HTMX compatibility in checkout and portal routes
  - StripeApiClient wrapping Stripe SDK for production use
  - StripeService wired into server with env var configuration
  - Conditional billing routes registration (only when STRIPE_SECRET_KEY set)
affects: [03-plan-enforcement, 04-trial-lifecycle]

# Tech tracking
tech-stack:
  added:
    - "Stripe SDK v20 (stripe npm package already installed)"
  patterns:
    - "HX-Redirect header for HTMX full-page navigation (checkout/portal)"
    - "Conditional service registration based on env vars (no Stripe = no routes)"
    - "Plan parameter validation in checkout (pro/team only, rejects free/invalid)"
    - "StripeApiClient implementing StripeClient interface (dependency inversion)"
    - "Template-based billing UI with usage percentage bars"

key-files:
  created:
    - src/templates/settings/billing.hbs
    - src/services/billing/stripeApiClient.ts
  modified:
    - src/server/routes/settings/billing.ts
    - src/server/routes/settings/billing.test.ts
    - src/server/createAppServer.ts
    - sample.env

key-decisions:
  - "HX-Redirect for HTMX, JSON for non-HTMX - dual response pattern based on hx-request header"
  - "Checkout plan validation - only pro/team allowed, free/invalid return 400"
  - "Billing routes registered conditionally - missing STRIPE_SECRET_KEY = no crash, just no routes"
  - "StripeApiClient uses (sub as any).current_period_end - Stripe types don't expose snake_case properties"
  - "Free users see 'Upgrade Plan' link, paid users with stripeCustomerId see 'Manage Billing' button"
  - "Usage bars show percentage width based on current/limit ratio"

patterns-established:
  - "HX-Redirect response pattern: check hx-request header, return redirect or JSON"
  - "Conditional service wiring: if (env.VAR) { instantiate + register }"
  - "Plan parameter from request body: extract, validate, map to enum"

# Metrics
duration: 6min
completed: 2026-02-11T02:59:59Z
---

# Phase 2 Plan 3: Billing Settings & Checkout Flow Summary

**Billing settings page displays current plan and usage with HTMX-compatible Stripe Checkout/Portal redirect flow, wired into server with production StripeApiClient**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-11T02:54:03Z
- **Completed:** 2026-02-11T02:59:59Z
- **Tasks:** 2 (no TDD - integration work)
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments

- Billing settings template shows current plan (Free/Pro/Team) and usage bars for repos/services/users
- GET /settings/billing route renders page with plan info and usage percentages
- POST /api/billing/checkout accepts plan parameter (pro/team), validates, creates Stripe Checkout session
- HX-Redirect header support for HTMX requests (checkout and portal routes)
- StripeApiClient wraps Stripe SDK and implements StripeClient interface for production use
- StripeService instantiated in createAppServer with env var config (proPriceId, teamPriceId, success/cancel URLs)
- Billing routes registered conditionally - only when STRIPE_SECRET_KEY is set
- Stripe env vars added to sample.env (SECRET_KEY, WEBHOOK_SECRET, PRO_PRICE_ID, TEAM_PRICE_ID)
- All tests pass (54 billing-related tests)

## Task Commits

Each task was committed atomically:

1. **Task 1: Billing settings page template and route** - `3ac5011` (feat)

   - Created src/templates/settings/billing.hbs with plan display, usage bars, and CTAs
   - Added GET /settings/billing route rendering page with usage data
   - Updated POST /api/billing/checkout to accept plan parameter (pro/team validation)
   - Added HX-Redirect header support for HTMX requests (checkout and portal)
   - Comprehensive tests for page rendering, plan validation, HTMX redirect

2. **Task 2: Wire StripeService and billing routes into server** - `bfadc13` (feat)
   - Created src/services/billing/stripeApiClient.ts wrapping Stripe SDK
   - Updated createAppServer.ts to instantiate StripeService with env var config
   - Registered billing routes conditionally (only when STRIPE_SECRET_KEY set)
   - Added Stripe env vars to sample.env

## Files Created/Modified

### Templates

- `src/templates/settings/billing.hbs` - Billing settings page with plan display, usage bars, and Manage Billing / Upgrade Plan CTAs

### Route Layer

- `src/server/routes/settings/billing.ts` - Added GET /settings/billing route, updated POST routes with plan parameter and HX-Redirect
- `src/server/routes/settings/billing.test.ts` - Added tests for page rendering, plan validation, HTMX redirect

### Service Layer

- `src/services/billing/stripeApiClient.ts` - Production Stripe client implementing StripeClient interface

### Server Wiring

- `src/server/createAppServer.ts` - Instantiate StripeService and register billing routes conditionally

### Configuration

- `sample.env` - Added Stripe env vars (SECRET_KEY, WEBHOOK_SECRET, PRO_PRICE_ID, TEAM_PRICE_ID)

## Decisions Made

**HX-Redirect for HTMX, JSON for non-HTMX:**

- Checkout and portal routes check `hx-request` header
- HTMX requests: return HX-Redirect header with 200 status
- Non-HTMX requests: return JSON with checkoutUrl/portalUrl
- Enables HTMX full-page navigation to Stripe hosted pages

**Plan validation in checkout:**

- Only `pro` and `team` allowed as plan parameter
- `free` or invalid plans return 400 error
- Plan string mapped to Plan enum (Pro/Team)
- Prevents creating checkout sessions for free plan

**Conditional billing routes registration:**

- Billing routes only registered when STRIPE_SECRET_KEY env var is set
- Test/dev environments without Stripe don't crash
- Allows gradual rollout and local dev without Stripe config

**StripeApiClient type handling:**

- Stripe SDK doesn't expose snake_case properties in TypeScript types
- Used `(sub as any).current_period_end` to access Stripe API response
- Converts Unix epoch seconds to JavaScript Date

**UI conditional rendering:**

- Free users see "Upgrade Plan" link to /onboarding/plan-selection
- Paid users with stripeCustomerId see "Manage Billing" button (opens Customer Portal)
- Usage bars show percentage width based on current/limit ratio

## Deviations from Plan

None - plan executed exactly as written. All required functionality implemented and tested.

## Issues Encountered

**TypeScript compilation error in StripeApiClient:**

- Stripe SDK types don't expose `current_period_end` property
- Stripe API returns snake_case but TypeScript types use camelCase
- **Resolution:** Used `(sub as any).current_period_end` to access property
- Test mock uses camelCase `currentPeriodEnd` (matches StripeClient interface)

**Template rendering error in test:**

- Initial test setup missing `navigation` partial registration
- Template uses `{{> navigation }}` but partial not found
- **Resolution:** Added `navigation` partial to view options in test setup

**Plan parameter required for checkout:**

- Existing test didn't include plan parameter (now required)
- **Resolution:** Updated test to include `plan: "pro"` in request body

## User Setup Required

**Stripe Configuration (optional for dev/test):**

1. **Create Stripe account** - https://dashboard.stripe.com/register
2. **Get API keys** - Dashboard → Developers → API keys
   - Copy Secret key (starts with `sk_test_`) to `STRIPE_SECRET_KEY`
3. **Create products and prices:**
   - Dashboard → Products → Add product
   - Pro plan: $19/month recurring
   - Team plan: $49/month recurring
   - Copy Price IDs (start with `price_`) to env vars
4. **Create webhook endpoint** - Dashboard → Developers → Webhooks
   - Point to your-domain/webhooks/stripe
   - Copy Signing secret (starts with `whsec_`) to `STRIPE_WEBHOOK_SECRET`
5. **Enable Customer Portal** - Dashboard → Settings → Billing → Customer portal (test mode)

**Environment Variables (add to .env):**

```
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRO_PRICE_ID=price_xxx
STRIPE_TEAM_PRICE_ID=price_xxx
```

**Note:** Billing routes are NOT registered without `STRIPE_SECRET_KEY` - safe to run without Stripe in dev/test.

## Next Phase Readiness

**Phase 3 (Plan Enforcement) is ready:**

- Billing settings page provides visibility into usage limits
- Users can see when they're approaching limits
- "Upgrade Plan" link provides clear path to upgrade
- PlanEnforcementService already enforces limits
- No blockers

**Phase 4 (Trial & Payment Lifecycle) is ready:**

- Checkout flow complete and tested
- Customer Portal integration ready
- Webhook infrastructure ready (from Phase 1)
- Trial logic can build on existing plan model
- No blockers

---

_Phase: 02-plan-selection-checkout_
_Plan: 03_
_Completed: 2026-02-11T02:59:59Z_
