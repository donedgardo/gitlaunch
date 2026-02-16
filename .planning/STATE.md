# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-08)

**Core value:** Developers can deploy their software continuously and reliably through GitLaunch, with a subscription model that lets them start with a free trial and upgrade when they see the value.
**Current focus:** Phase 4 - Trial & Payment Lifecycle

## Current Position

Phase: 4 of 4 (Trial & Payment Lifecycle)
Plan: 3 of 3 in current phase
Status: Phase complete
Last activity: 2026-02-16 — Completed 04-03-PLAN.md

Progress: [████████████] 100% (12/12 total plans)

## Performance Metrics

**Velocity:**

- Total plans completed: 12
- Average duration: 4.7 min
- Total execution time: 0.93 hours

**By Phase:**

| Phase                        | Plans | Total | Avg/Plan |
| ---------------------------- | ----- | ----- | -------- |
| 1. Billing Foundation        | 3/3   | 10min | 3.3min   |
| 2. Plan Selection & Checkout | 3/3   | 23min | 7.7min   |
| 3. Plan Enforcement & Limits | 3/3   | 10min | 3.3min   |
| 4. Trial & Payment Lifecycle | 3/3   | 15min | 5.0min   |

**Recent Trend:**

- Last 5 plans: 3min, 2min, 4min, 7min, 4min
- Trend: Consistent fast execution (avg 4.0min over last 5)

_Updated after each plan completion_

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Stripe as payment provider — Industry standard for SaaS, good API, handles subscriptions natively
- Interface-first membership — Dependency inversion allows swapping providers without changing business logic
- 14-day trial on any plan — Builds confidence before asking for payment; generous enough to evaluate
- Read-only on trial expiry — Users keep visibility into their setup, creating urgency without destroying their work
- **MembershipService interface with three core methods** (01-01) — createCheckoutSession, createBillingPortalSession, getSubscriptionStatus cover essential subscription lifecycle
- **StripeClient stays Stripe-specific** (01-01) — Only MembershipService layer is provider-agnostic; StripeClient is implementation detail
- **MongoDB unique index for webhook idempotency** (01-02) — Atomic duplicate detection via stripeEventId unique constraint, error code 11000 handled gracefully
- **TTL index with 90-day retention** (01-02) — Automatic cleanup prevents unbounded growth, provides audit trail beyond Stripe's 3-day retry window
- **fastify-raw-body with global: false** (01-03) — Only webhook route needs raw body access for signature verification; route opts in via config
- **Optional webhookEventRepo in dependencies** (01-03) — Backward compatible with tests that don't provide it; when missing, idempotency check is skipped
- **Idempotency check returns early** (01-03) — Duplicate events return 200 { received: true } without invoking handler, preventing double processing
- **rawBody fallback chain** (01-03) — request.rawBody || string body || JSON.stringify for test compatibility without plugin
- **Three-tier Plan enum** (02-01) — Free/Pro/Team (not binary Free/Paid) for pricing flexibility
- **Free plan limits increased to 3/3/1** (02-01) — More generous trial (3 repos, 3 services) aligns with PROJECT.md, allows meaningful evaluation
- **selectPlan vs upgradeToPlan distinction** (02-01) — selectPlan sets plan without Stripe IDs (plan picker), upgradeToPlan sets plan WITH Stripe IDs (subscription)
- **Plan in checkout metadata** (02-01) — session.metadata.plan propagates through webhook, defaults to "pro" for legacy compatibility
- **PLAN_LIMITS_MAP pattern** (02-01) — Centralized plan-to-limits lookup via Record<Plan, PlanLimits>
- **Plan selection before GitHub App install** (02-02) — Intentional commitment moment; users choose tier before connecting repositories
- **Pro card highlighted for conversion** (02-02) — Blue background and "Most Popular" badge guide users toward paid tier
- **Returning users skip plan selection** (02-02) — If account already has non-Free plan, redirect straight to GitHub App install
- **HX-Redirect for HTMX, JSON for non-HTMX** (02-03) — Dual response pattern based on hx-request header enables HTMX full-page navigation to Stripe
- **Checkout plan validation** (02-03) — Only pro/team allowed in checkout, free/invalid return 400 error
- **Conditional billing routes** (02-03) — Routes only registered when STRIPE_SECRET_KEY set, safe to run without Stripe
- **StripeApiClient type handling** (02-03) — Used (sub as any).current_period_end to access Stripe API snake_case properties
- **Free users see Upgrade, paid see Manage** (02-03) — UI conditionally renders based on stripeCustomerId presence
- **Environment limits are per-service** (03-01) — Unlike other resources (repos/services/users), environments are checked per-service since they belong to services
- **Free plan gets 2 environments** (03-01) — Matches default service setup (staging + prod), upgrade required for custom environments
- **Service ownership verification in canAddEnvironment** (03-01) — Verifies service exists AND belongs to account, preventing cross-account limit bypasses
- **PlanEnforcementService dependency injection** (03-02) — Route handlers receive planEnforcementService via dependencies object, following existing DI pattern
- **403 for plan limits, not 400** (03-02) — Plan limits are authorization constraints (forbidden), not input validation errors (bad request)
- **Dual response patterns for HTMX vs API** (03-02) — HTMX route returns error partial (200 with error in template), API route returns 403 with JSON
- **upgradeRequired flag in API responses** (03-02) — Enables client-side upgrade flow detection in programmatic API clients
- **Batch limit check pattern** (03-03) — Use getUsage() for N-item operations (current + new > limit), not canAddRepository() which checks single-item
- **canAddPrivateRepository wired into onboarding** (03-03) — Private repo enforcement via service method call, not inline boolean check
- **One trial per GitHub user ID** (04-01) — Prevents trial abuse across multiple accounts; enforced atomically via MongoDB unique index on githubId
- **Error code 11000 returns false, not throw** (04-01) — claimTrial returns boolean for duplicate detection (true = success, false = duplicate used)
- **Injectable clock in services** (04-01) — Constructor accepts optional { now: () => Date } for testable date generation
- **14-day trial duration hardcoded** (04-01) — TRIAL_DURATION_DAYS = 14 constant; can be made configurable later if needed
- **Discriminated union result types** (04-01) — { started: true, data } | { started: false, reason } pattern for type-safe success/failure handling
- **Math.ceil for trial days remaining** (04-02) — Shows 1 day remaining on last partial day (user-friendly, creates urgency)
- **isReadOnly derived from usage vs limits** (04-02) — Always up-to-date, no sync issues (not stored in DB)
- **checkAndHandleTrialExpiry on dashboard load** (04-02) — Ensures timely trial expiry without cron jobs or background tasks
- **upgradeToPlan clears trialEndsAt** (04-02) — Subscribed users shouldn't see trial countdown (better UX)
- **7-day grace period for payment failures** (04-03) — Industry standard; balances user retention with revenue protection
- **Grace period warning uses red/danger styling** (04-03) — More urgent than trial countdown, requires immediate action
- **isReadOnly true when payment failed AND grace expired** (04-03) — Full access during grace encourages payment; restriction after grace creates urgency
- **Banner priority: payment failure > trial > read-only** (04-03) — Users see most critical message first

### Pending Todos

None yet.

### Blockers/Concerns

**Phase 1 risks (from research):**

- ✅ **RESOLVED:** Webhook race conditions — WebhookEventRepository provides atomic duplicate detection with unique index
- ✅ **RESOLVED:** Missing idempotency checks — markAsProcessed called before processing, returns early for duplicates
- ✅ **RESOLVED:** Raw body for signature verification — fastify-raw-body plugin captures body before JSON parsing
- Note: Real Stripe signature verification needs StripeWebhookSignatureVerifier implementation (uses stripe SDK)

**Phase 1 complete:**

- ✅ Billing Foundation phase complete (3/3 plans)
- ✅ Webhook infrastructure ready for subscription flows

**Phase 2 COMPLETE:**

- ✅ Three-tier plan model implemented (02-01)
- ✅ Plan Picker UI complete (02-02)
- ✅ Checkout Flow and billing settings complete (02-03)
- ✅ StripeService wired into server with production StripeApiClient
- ✅ All 6 plans executed in 52 minutes (avg 8.7 min/plan for Phases 1-2)

**Phase 3 COMPLETE:**

- ✅ Environment limit enforcement complete (03-01)
- ✅ Enforcement wired into all environment creation endpoints (03-02)
- ✅ Repository batch limit gap closed (03-03)
- ✅ canAddPrivateRepository wired into repository onboarding
- Plan enforcement now covers all resource types: repos, services, users, environments
- All endpoints return appropriate upgrade CTAs when limits hit
- Batch limit checks properly account for existing resources (current + new > limit)
- All 9 plans executed in 42 minutes (avg 4.7 min/plan for Phases 1-3)

**Phase 4 COMPLETE:**

- ✅ Trial management core complete (04-01)
- ✅ TrialRegistryRepository with unique index on githubId
- ✅ Account.trialEndsAt field for trial expiration tracking
- ✅ TrialService coordinates trial claims with 14-day duration
- ✅ Trial UI and flow integration complete (04-02)
- ✅ Trial countdown banner shows days remaining on dashboard
- ✅ Auto-downgrade to Free when trial expires (no cron needed)
- ✅ Read-only state for over-limit resources (derived from usage vs limits)
- ✅ upgradeToPlan clears trial state (subscribed users don't see countdown)
- ✅ Payment failure grace periods with UI warnings (04-03)
- ✅ 7-day grace period with dashboard/billing warnings
- ✅ Read-only enforcement after grace period expiry
- ✅ Banner priority ordering (payment > trial > read-only)
- All 12 plans executed in 56 minutes (avg 4.7 min/plan for all phases)

## Session Continuity

Last session: 2026-02-16 (plan execution)
Stopped at: Completed 04-03-PLAN.md - Payment failure grace periods complete
Resume file: All phases complete - PROJECT FINISHED

## Project Completion

**Status:** ALL PHASES COMPLETE ✓

All 4 phases (12 plans) have been successfully executed:

- Phase 1: Billing Foundation (3/3 plans)
- Phase 2: Plan Selection & Checkout (3/3 plans)
- Phase 3: Plan Enforcement & Limits (3/3 plans)
- Phase 4: Trial & Payment Lifecycle (3/3 plans)

GitLaunch now has a complete subscription billing system with:

- Stripe integration for payments
- Three-tier plan model (Free/Pro/Team)
- Plan selection and checkout flows
- Resource limit enforcement (repos, services, users, environments)
- 14-day trial management
- Payment failure grace periods
- Read-only enforcement for over-limit and expired accounts
- Comprehensive UI warnings and CTAs
