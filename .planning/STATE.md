# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-08)

**Core value:** Developers can deploy their software continuously and reliably through GitLaunch, with a subscription model that lets them start with a free trial and upgrade when they see the value.
**Current focus:** Phase 2 - Plan Selection & Checkout

## Current Position

Phase: 2 of 4 (Plan Selection & Checkout)
Plan: 2 of 3 in current phase
Status: In progress
Last activity: 2026-02-10 — Completed 02-plan-selection-checkout-02-PLAN.md

Progress: [█████░░░░░] 45% (5/11 total plans)

## Performance Metrics

**Velocity:**

- Total plans completed: 5
- Average duration: 5.4 min
- Total execution time: 0.45 hours

**By Phase:**

| Phase                        | Plans | Total | Avg/Plan |
| ---------------------------- | ----- | ----- | -------- |
| 1. Billing Foundation        | 3/3   | 10min | 3.3min   |
| 2. Plan Selection & Checkout | 2/3   | 17min | 8.5min   |
| 3. Plan Enforcement & Limits | 0/2   | —     | —        |
| 4. Trial & Payment Lifecycle | 0/3   | —     | —        |

**Recent Trend:**

- Last 5 plans: 2min, 5min, 14min, 3min
- Trend: Phase 2-02 was quick (3min) - straightforward UI work following existing patterns

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

**Phase 2 in progress:**

- ✅ Three-tier plan model implemented (02-01)
- ✅ Plan Picker UI complete (02-02)
- Checkout Flow next (02-03)
- No blockers

## Session Continuity

Last session: 2026-02-10 (plan execution)
Stopped at: Completed 02-plan-selection-checkout-02-PLAN.md - Plan Picker UI complete
Resume file: .planning/phases/02-plan-selection-checkout/02-03-PLAN.md (Checkout Flow)
