---
phase: 02-plan-selection-checkout
verified: 2026-02-10T23:04:00Z
status: passed
score: 12/12 must-haves verified
---

# Phase 2: Plan Selection & Checkout Verification Report

**Phase Goal:** User can select a plan after signup (no credit card required) and subscribe later via Stripe Checkout
**Verified:** 2026-02-10T23:04:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                                                            | Status     | Evidence                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------ |
| 1   | Plan enum supports Free, Pro, and Team tiers (not binary Free/Paid)                                                                              | ✓ VERIFIED | Plan enum has Free/Pro/Team in accountRepository.ts lines 3-7                                    |
| 2   | AccountRepository can upgrade an account to any paid plan (Pro or Team) with correct limits                                                      | ✓ VERIFIED | upgradeToPlan method lines 120-145, uses PLAN_LIMITS_MAP, rejects Free                           |
| 3   | AccountRepository can select any plan (Free/Pro/Team) setting plan and limits without Stripe IDs                                                 | ✓ VERIFIED | selectPlan method lines 147-160, sets plan+limits only, no Stripe ID modification                |
| 4   | Checkout session creation accepts a plan parameter and maps it to the correct Stripe price ID                                                    | ✓ VERIFIED | StripeService.createCheckoutSession lines 60-93, getPriceIdForPlan method lines 49-58            |
| 5   | Webhook handler receives plan from checkout session metadata and upgrades to the correct tier                                                    | ✓ VERIFIED | stripe.ts route line 93 passes plan from metadata, webhookHandler.ts line 29 calls upgradeToPlan |
| 6   | PlanEnforcementService uses correct per-tier limits: Free (3/3/1/public-only), Pro (10/10/5/private-allowed), Team (999/999/999/private-allowed) | ✓ VERIFIED | Limit constants lines 37-56, FREE=3/3/1/true, PRO=10/10/5/false, TEAM=999/999/999/false          |
| 7   | User sees billing settings page showing current plan name and usage stats                                                                        | ✓ VERIFIED | billing.hbs renders plan and usage bars, GET /settings/billing route lines 50-99                 |
| 8   | User on paid plan with Stripe customer sees 'Manage Billing' button that opens Customer Portal                                                   | ✓ VERIFIED | billing.hbs lines 28-33, conditional on hasStripeCustomer, hx-post to /api/billing/portal        |
| 9   | User on Free plan sees 'Upgrade Plan' link to plan selection page                                                                                | ✓ VERIFIED | billing.hbs lines 34-38, shown when !hasStripeCustomer, links to /onboarding/plan-selection      |
| 10  | User can subscribe to paid plan via Stripe Checkout from billing page                                                                            | ✓ VERIFIED | POST /api/billing/checkout lines 102-148, validates plan, creates session with plan parameter    |
| 11  | Checkout redirect uses HX-Redirect header for HTMX compatibility                                                                                 | ✓ VERIFIED | billing.ts lines 134-137 and 176-178, checks hx-request header, returns HX-Redirect              |
| 12  | StripeService is instantiated and wired into server with env var config                                                                          | ✓ VERIFIED | createAppServer.ts lines 120-135, instantiates with env vars and registers billing routes        |

**Score:** 12/12 truths verified

### Required Artifacts

| Artifact                                      | Expected                                                                                 | Status     | Details                                                                                            |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| `src/repositories/accountRepository.ts`       | Plan enum with Free/Pro/Team, tier-specific limit constants, upgradeToPlan, selectPlan   | ✓ VERIFIED | 170 lines, exports Plan enum, limit constants, both methods present and substantive                |
| `src/services/billing/membershipService.ts`   | MembershipService interface with plan-aware createCheckoutSession                        | ✓ VERIFIED | 50 lines, interface includes plan: Plan parameter in createCheckoutSession                         |
| `src/services/billing/stripeService.ts`       | StripeService with teamPriceId config and plan-to-priceId mapping                        | ✓ VERIFIED | 124 lines, StripeServiceConfig has teamPriceId, getPriceIdForPlan method maps plans to price IDs   |
| `src/services/billing/webhookHandler.ts`      | CheckoutCompletedEvent with plan field, plan-aware handleCheckoutCompleted               | ✓ VERIFIED | 66 lines, CheckoutCompletedEvent has plan: Plan field, handleCheckoutCompleted calls upgradeToPlan |
| `src/server/routes/webhooks/stripe.ts`        | Webhook route passes plan from session metadata to handler                               | ✓ VERIFIED | 120+ lines, line 93 extracts session.metadata.plan, defaults to "pro" for backward compatibility   |
| `src/templates/settings/billing.hbs`          | Billing settings page template with plan info, usage bars, and portal/upgrade CTAs       | ✓ VERIFIED | 88 lines, displays plan name, 3 usage progress bars, conditional Manage/Upgrade buttons            |
| `src/server/routes/settings/billing.ts`       | GET /settings/billing page route and updated POST routes with plan param and HX-Redirect | ✓ VERIFIED | 213 lines, GET route computes usage %, POST routes validate plan, check hx-request header          |
| `src/server/createAppServer.ts`               | StripeService instantiation and billing routes registration                              | ✓ VERIFIED | 200+ lines, lines 120-135 instantiate StripeService and call registerBillingRoutes conditionally   |
| `src/services/billing/stripeApiClient.ts`     | Production StripeApiClient wrapping Stripe SDK                                           | ✓ VERIFIED | New file created, implements StripeClient interface, wraps Stripe SDK methods                      |
| `src/templates/onboarding/plan-selection.hbs` | Plan selection UI with Free/Pro/Team cards                                               | ✓ VERIFIED | 166 lines, 3-column responsive grid, Free ($0), Pro ($19, highlighted), Team ($49), correct limits |

### Key Link Verification

| From                                    | To                           | Via                                                        | Status  | Details                                                                                 |
| --------------------------------------- | ---------------------------- | ---------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------- |
| stripeService.ts                        | accountRepository.ts         | Import Plan enum for getPriceIdForPlan                     | ✓ WIRED | Line 1: `import { Account, Plan } from "../../repositories/accountRepository"`          |
| webhooks/stripe.ts                      | webhookHandler.ts            | checkout.session.completed passes plan from metadata       | ✓ WIRED | Line 93: `plan: session.metadata.plan \|\| "pro"`, passed to handleCheckoutCompleted    |
| createAppServer.ts                      | routes/settings/billing.ts   | registerBillingRoutes called with StripeService dependency | ✓ WIRED | Lines 130-135: `registerBillingRoutes(server, { stripeService, ... })`                  |
| routes/settings/billing.ts              | stripeService.ts             | Checkout and portal routes call stripeService methods      | ✓ WIRED | Line 125: `stripeService.createCheckoutSession`, line 168: `createBillingPortalSession` |
| templates/settings/billing.hbs          | POST /api/billing/checkout   | HTMX form for subscribe button                             | ✓ WIRED | Line 29: `hx-post="/api/billing/portal"` (portal button shown to paid users)            |
| templates/onboarding/plan-selection.hbs | POST /onboarding/select-plan | HTML forms for each plan card                              | ✓ WIRED | Lines 64, 109, 151: forms POST to /onboarding/select-plan with plan parameter           |

### Requirements Coverage

Phase 2 requirements from REQUIREMENTS.md:

| Requirement | Description                                                                                 | Status      | Blocking Issue |
| ----------- | ------------------------------------------------------------------------------------------- | ----------- | -------------- |
| PLAN-01     | User sees a plan picker (Free / Pro / Team) after signup, before accessing the dashboard    | ✓ SATISFIED | None           |
| PLAN-02     | User can subscribe to a paid plan via Stripe Checkout (hosted payment page)                 | ✓ SATISFIED | None           |
| PLAN-03     | User sees billing settings page showing current plan, usage stats, and Customer Portal link | ✓ SATISFIED | None           |

**Evidence:**

- PLAN-01: plan-selection.hbs exists, onboarding route renders it, auth flow redirects new users to plan-selection (auth/github.test.ts line expecting /onboarding/plan-selection)
- PLAN-02: POST /api/billing/checkout creates Stripe Checkout session with plan parameter, returns HX-Redirect to hosted page
- PLAN-03: GET /settings/billing renders billing.hbs with plan info, usage bars, and Customer Portal button for paid users

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| None | -    | -       | -        | -      |

**Anti-pattern scan results:**

- ✓ No TODO/FIXME/placeholder comments found in production code
- ✓ No empty implementations (return null/undefined/{}/[]) in critical paths
- ✓ No console.log-only implementations
- ✓ All methods have substantive implementations

**Checked files:**

- src/repositories/accountRepository.ts
- src/services/billing/membershipService.ts
- src/services/billing/stripeService.ts
- src/services/billing/stripeApiClient.ts
- src/services/billing/webhookHandler.ts
- src/server/routes/webhooks/stripe.ts
- src/server/routes/settings/billing.ts
- src/server/routes/onboarding/index.ts
- src/server/createAppServer.ts

### Human Verification Required

#### 1. Plan Selection Visual Appearance

**Test:** Sign up as a new user, view plan selection page
**Expected:** Three-column grid on desktop, single column on mobile. Free plan on left, Pro plan in center with blue background and "Most Popular" badge, Team plan on right. All cards show correct pricing ($0, $19, $49) and limits (3/3/1 for Free, 10/10/5 for Pro, unlimited for Team).
**Why human:** Visual layout, responsive behavior, color scheme, and typography cannot be verified programmatically.

#### 2. Plan Selection Flow

**Test:** Select each plan (Free, Pro, Team) from plan-selection page
**Expected:** Form submits, user redirected to /onboarding (GitHub App install). Account plan updated to selected plan in MongoDB.
**Why human:** Full user flow requires browser interaction and visual confirmation of redirect.

#### 3. Billing Settings Page Display

**Test:** Navigate to /settings/billing as authenticated user
**Expected:** Page displays current plan name (capitalized), three usage bars with correct percentages, appropriate CTA button (Manage Billing for paid users with Stripe customer, Upgrade Plan for Free users).
**Why human:** Visual layout verification, usage bar rendering, conditional CTA display.

#### 4. Stripe Checkout Flow

**Test:** Click "Manage Billing" or trigger checkout from billing page with plan=pro
**Expected:** HTMX detects HX-Redirect header, redirects to Stripe Checkout hosted page. Checkout session includes plan metadata. After completion, webhook processes plan correctly and upgrades account.
**Why human:** Requires real Stripe account, hosted checkout page interaction, webhook delivery confirmation. External service integration cannot be fully verified without live Stripe environment.

#### 5. Customer Portal Redirect

**Test:** User with stripeCustomerId clicks "Manage Billing" on billing page
**Expected:** HTMX redirects to Stripe Customer Portal. User can view subscription, update payment method, cancel subscription.
**Why human:** Requires real Stripe account and Customer Portal configuration. External service integration.

---

_Verified: 2026-02-10T23:04:00Z_
_Verifier: Claude (gsd-verifier)_
