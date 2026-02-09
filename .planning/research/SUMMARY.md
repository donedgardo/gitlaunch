# Research Summary: GitLaunch Subscription Billing

**Domain:** SaaS Subscription Billing for Deployment Management Tool
**Researched:** 2026-02-08
**Overall Confidence:** HIGH

## Executive Summary

Adding Stripe-based subscription billing to GitLaunch is a well-trodden path with mature tooling and clear best practices. The recommended approach leverages Stripe's hosted solutions (Checkout, Customer Portal) to minimize custom UI development while maintaining brand consistency. The critical success factors are: (1) robust webhook infrastructure with idempotency and event ordering, (2) plan enforcement middleware that checks limits server-side before resource creation, and (3) Stripe as the single source of truth for subscription state, with MongoDB caching only essential data for performance.

The existing GitLaunch architecture is well-positioned for this addition. The service-based design, dependency injection pattern, and MongoDB storage align naturally with the billing service layer pattern. The account-based multi-tenancy already exists, requiring only extension of the Account model to store plan state and Stripe metadata.

The primary risks are webhook race conditions and missing idempotency checks, which can corrupt subscription state in production. These must be addressed in Phase 1 (webhook infrastructure) before implementing any subscription logic. The second major risk is incomplete payment handling, where subscription status shows "active" but invoices remain unpaid. This requires checking both subscription AND invoice status for access control decisions.

The recommended tech stack is battle-tested: stripe@20.3.1 (official SDK with built-in TypeScript types), fastify-stripe@2.0.0 (Fastify plugin for SDK encapsulation), @fastify/raw-body@5.0.0 (required for webhook signature verification), and Stripe CLI for local development. No custom payment forms or invoice generation required—Stripe provides all necessary UI components.

## Key Findings

**Stack:** Use Stripe official SDK (v20.3.1) + Fastify plugin + Stripe hosted UI (Checkout, Customer Portal). No custom payment forms.

**Architecture:** Event-driven webhook pattern with async processing. Plan enforcement via service layer middleware. MongoDB caches subscription state (updated via webhooks). Stripe is source of truth.

**Critical Pitfall:** Webhook event ordering race conditions + missing idempotency checks corrupt subscription state. Must address in Phase 1 before any subscription logic.

## Implications for Roadmap

Based on research, suggested phase structure:

### 1. **Webhook Infrastructure Foundation** - First, because everything depends on it

- Addresses: Event ordering, idempotency, signature verification, async processing
- Avoids: All 10 critical pitfalls depend on webhook foundation
- Duration: ~1 week
- **Why first:** Webhooks are source of truth for all subscription state changes. Build incorrectly and you corrupt data. Cannot test subscription flows without webhook infrastructure.

### 2. **Data Model & Repository Layer** - Second, foundation for state storage

- Addresses: Account model extension (plan, limits, Stripe IDs), AccountRepository operations (upgradeToPaid, downgradeToFree)
- Avoids: "Storing plan limits in multiple places" anti-pattern
- Duration: ~3 days
- **Why second:** Webhook handlers need somewhere to write subscription state. Must be designed before webhooks can process events.

### 3. **Stripe Integration & Checkout Flow** - Third, enables revenue

- Addresses: Stripe SDK wrapper, Checkout Sessions, plan selection UI, billing settings page
- Avoids: "Custom payment forms" anti-feature (PCI compliance burden)
- Duration: ~1 week
- **Why third:** User can now initiate upgrades. Webhooks (Phase 1) process payment completions. Data model (Phase 2) stores results.

### 4. **Plan Enforcement Middleware** - Fourth, enforces business logic

- Addresses: Limit checking before resource creation, PlanEnforcementService, error handling with upgrade CTAs
- Avoids: "Client-side plan state" anti-pattern (security vulnerability)
- Duration: ~1 week
- **Why fourth:** Requires working upgrade flow (Phase 3) to be testable. Users must be able to upgrade when hitting limits.

### 5. **Trial Management** - Fifth, conversion optimization

- Addresses: 14-day trials, trial start/end logic, auto-downgrade, trial countdown UI, trial_will_end webhook handling
- Avoids: "Missing payment method before trial end" pitfall
- Duration: ~1 week
- **Why fifth:** Depends on enforcement (Phase 4) and webhooks (Phase 1) being stable. Complex edge cases require solid foundation.

### 6. **Payment Failure & Recovery** - Sixth, reduces involuntary churn

- Addresses: Failed payment webhooks, grace periods, dunning emails, payment retry prompts
- Avoids: "Subscription status doesn't guarantee payment" pitfall
- Duration: ~3 days
- **Why sixth:** Edge case handling after core flows proven stable. Requires full subscription lifecycle in place to test.

### 7. **Plan Management (Upgrade/Downgrade)** - Seventh, user flexibility

- Addresses: Self-service plan changes, proration preview, downgrade scheduling, Customer Portal integration
- Avoids: "Proration masks unpaid invoices" pitfall, "Hard-deleting resources on downgrade" anti-pattern
- Duration: ~1 week
- **Why seventh:** Complex state transitions require all previous phases stable. Proration logic depends on invoice handling (Phase 6).

### 8. **Polish & Optimization** - Eighth, UX refinement

- Addresses: Usage indicators, proactive upgrade prompts, email notifications, billing settings enhancements
- Avoids: "No warning before trial ends" UX pitfall
- Duration: Ongoing
- **Why last:** User experience improvements after core revenue generation proven. Can be iterated post-launch.

**Phase Ordering Rationale:**

- **Dependencies:** Webhooks → Data Model → Checkout → Enforcement → Trial → Payment Failure → Plan Changes → Polish
- **Risk Mitigation:** Build critical infrastructure (webhooks) before features that depend on it
- **Testing:** Each phase requires previous phases working to be testable
- **Revenue Generation:** Phase 3 (Checkout) enables first revenue. Everything before is foundation. Everything after is optimization.

**Research Flags for Phases:**

- **Phase 1 (Webhooks):** Standard patterns, unlikely to need research. Stripe docs comprehensive.
- **Phase 2 (Data Model):** Standard patterns, unlikely to need research. MongoDB schema design well-understood.
- **Phase 3 (Checkout):** Standard patterns, unlikely to need research. Stripe Checkout Sessions documented.
- **Phase 4 (Enforcement):** Likely needs deeper research for edge cases (soft limits, grace periods, granular limits per resource type).
- **Phase 5 (Trial):** Likely needs deeper research for trial extension, early conversion, trial-to-paid optimization.
- **Phase 6 (Payment Failure):** Likely needs deeper research for dunning strategies, retry timing, grace period policies.
- **Phase 7 (Plan Changes):** Likely needs deeper research for proration handling, billing cycle preservation, downgrade data retention.
- **Phase 8 (Polish):** Standard UX patterns, unlikely to need research. Can A/B test after launch.

## Confidence Assessment

| Area         | Confidence | Notes                                                                                                                                                                                                  |
| ------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stack        | HIGH       | Official Stripe SDK with built-in types, active maintenance, verified version (20.3.1). Fastify plugin verified in ecosystem. Stripe Checkout/Portal are production-ready hosted solutions.            |
| Features     | HIGH       | Table stakes validated across 5+ SaaS billing articles. Trial conversion benchmarks from multiple sources (18-25% B2B). Feature prioritization backed by competitor analysis (GitHub, Vercel, Heroku). |
| Architecture | HIGH       | Event-driven webhook pattern is Stripe-recommended approach. Plan enforcement middleware is standard SaaS pattern. Stripe-as-source-of-truth validated in official docs and community articles.        |
| Pitfalls     | HIGH       | 10 critical pitfalls sourced from official Stripe docs, technical deep-dives, and production incident reports. Each pitfall includes recovery strategies and verification steps.                       |

**Overall HIGH confidence** due to:

1. Stack recommendations verified via official npm, GitHub repos, Stripe docs
2. Architecture patterns validated across official docs + 10+ technical articles
3. Pitfalls documented in official Stripe docs with workarounds
4. Features cross-referenced with competitor analysis + industry benchmarks
5. All claims backed by multiple sources (Context7 not needed—Stripe docs sufficient)

## Gaps to Address

### Minor Gaps (Manageable Within Phases)

1. **Team collaboration features:** Team member invites, role management, seat-based billing complexity. Research deferred to "Team plan implementation" sub-phase.

2. **Tax compliance:** Stripe Tax integration, VAT handling, tax ID collection. Standard Stripe feature but configuration varies by jurisdiction. Research when launching internationally.

3. **Usage-based billing:** Stripe Meters, usage event reporting, overage handling. Deferred to Phase 6+ if needed for advanced plans. Current research covers fixed-tier limits (sufficient for MVP).

4. **Dunning strategy optimization:** Email timing, retry intervals, retention offers. Initial implementation uses Stripe Smart Retries defaults. Optimize post-launch based on churn data.

5. **Annual billing discounts:** Pricing strategy (10% vs 20% discount?), billing cycle edge cases. Trivial in Stripe (just another Price), but pricing strategy requires market research.

### No Critical Gaps

All core capabilities researched:

- Stripe SDK integration (covered)
- Webhook infrastructure (covered)
- Plan enforcement (covered)
- Trial management (covered)
- Payment failure handling (covered)
- Checkout flow (covered)
- Customer Portal (covered)
- Subscription lifecycle (covered)

**No areas require additional research before Phase 1 starts.** All gaps are refinements for later phases or optional features deferred post-MVP.

## Technology Decisions Summary

### Core Stack (HIGH Confidence)

| Component           | Technology                      | Version | Rationale                                                                                                           |
| ------------------- | ------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------- |
| Stripe SDK          | stripe (official)               | ^20.3.1 | Official package with built-in TypeScript types, automatic retries, idempotency. Most current, actively maintained. |
| Fastify Integration | fastify-stripe                  | ^2.0.0  | Encapsulates Stripe in Fastify DI pattern. Follows framework conventions.                                           |
| Webhook Security    | @fastify/raw-body               | ^5.0.0  | Required for signature verification. Preserves raw request body needed by Stripe SDK.                               |
| Payment UI          | Stripe Checkout (hosted)        | N/A     | Stripe-hosted page. Minimal integration code. PCI compliant. Supports subscriptions out-of-box.                     |
| Billing Management  | Stripe Customer Portal (hosted) | N/A     | Stripe-hosted self-service portal. Zero custom UI needed. Configurable via Dashboard.                               |
| Local Testing       | Stripe CLI                      | Latest  | Forward webhooks to localhost. Trigger test events. Essential for development workflow.                             |

### Supporting Tools (MEDIUM Confidence)

| Component       | Technology         | When to Use                                        |
| --------------- | ------------------ | -------------------------------------------------- |
| Webhook Queue   | BullMQ + Redis     | At 1k+ subscriptions for async processing          |
| Limit Caching   | Redis              | At 10k+ users to reduce DB queries                 |
| Enhanced Types  | stripe-event-types | Optional if needing stronger webhook event types   |
| Test Automation | Stripe Test Clocks | Time-based subscription testing (trials, renewals) |

### What NOT to Use (HIGH Confidence)

- @types/stripe - Redundant (built into stripe package)
- Custom payment forms - PCI compliance burden, use Checkout instead
- Payment Intents API (for subscriptions) - More complex, use Checkout Sessions API
- Manual invoice generation - Use Stripe automatic invoicing
- Client-side limit enforcement - Security vulnerability, enforce server-side
- Old Stripe API versions - Type mismatches, use latest

## Feature Priorities Summary

### MVP (Phase 1-4, ~3 weeks)

Must-have for revenue generation:

1. Plan selection UI (Free/Pro/Team)
2. Stripe Checkout integration
3. Webhook processing (checkout.session.completed, subscription.updated/deleted)
4. Plan enforcement middleware (hard limits on repos, services, environments)
5. Billing settings page (current plan, usage, upgrade CTA)
6. Stripe Customer Portal link (payment method, invoices)

**Result:** Users can upgrade, get charged, and limits enforce correctly.

### Post-MVP (Phase 5-7, ~2.5 weeks)

Should-have for conversion and UX:

1. 14-day free trials (Pro/Team)
2. Trial countdown and expiration handling
3. Usage indicators (5 of 10 repos used)
4. Failed payment handling and grace periods
5. Self-service plan changes (upgrade/downgrade)
6. Email notifications (trial ending, payment failed, subscription changed)

**Result:** Optimized trial-to-paid funnel and reduced involuntary churn.

### Future (Phase 8+, ongoing)

Nice-to-have for scale and polish:

1. Annual billing option
2. Team member invites (Team plan)
3. Usage-based overages
4. Proactive upgrade prompts
5. Soft limits with grace periods
6. Plan recommendation wizard

**Result:** Expanded revenue opportunities and refined UX.

## Architectural Principles

### 1. Stripe as Source of Truth

- **Do:** Query Stripe API for payment history, invoice details, upcoming charges
- **Don't:** Store full subscription/invoice/payment data in MongoDB
- **Cache in MongoDB:** Subscription ID, Customer ID, plan name, limits, status (updated via webhooks)

### 2. Event-Driven State Updates

- **Do:** All subscription state changes come via webhooks
- **Don't:** Update subscription state in API route handlers
- **Pattern:** Webhook arrives → verify signature → queue event → process async → update MongoDB → return 200

### 3. Server-Side Enforcement

- **Do:** Check limits in service layer before resource creation
- **Don't:** Trust client-side plan state for authorization
- **Pattern:** User action → PlanEnforcementService.enforceLimit() → throws if exceeded → show upgrade CTA

### 4. Dependency Inversion for Testability

- **Do:** Define MembershipService interface, implement with StripeService
- **Don't:** Call Stripe SDK directly from route handlers
- **Pattern:** Core services depend on interface, not Stripe SDK. Allows mocking in tests.

### 5. Idempotent Webhook Processing

- **Do:** Store processed event IDs or design handlers to be naturally idempotent
- **Don't:** Process same webhook event multiple times
- **Pattern:** Check if event processed → skip if yes → process if no → mark as processed

## Risk Mitigation Checklist

Critical risks that could derail the project:

- [x] **Webhook race conditions researched** - Event ordering, timestamp-based deduplication documented in PITFALLS.md
- [x] **Idempotency pattern researched** - Event ID storage, natural idempotency approaches documented
- [x] **Signature verification researched** - HMAC verification using stripe.webhooks.constructEvent() documented
- [x] **Payment status pitfall researched** - Subscription status vs invoice status documented, both must be checked
- [x] **Trial end edge cases researched** - Missing payment method handling, trial_will_end event documented
- [x] **Proration complexity researched** - Preview upcoming invoice, proration masking unpaid invoices documented
- [x] **Rate limiting researched** - Stripe API rate limits (100 req/sec), exponential backoff documented
- [x] **Async payment methods researched** - ACH/SEPA transition to active before payment completes, documented
- [x] **Invoice finalization delays researched** - Fast webhook responses required, async processing pattern documented
- [x] **Security best practices researched** - Payment method storage, API key exposure, customer ID validation documented

**All critical risks identified and mitigation strategies documented.**

## Development Workflow

### Local Development Setup

1. Install Stripe CLI: `brew install stripe/stripe-cli/stripe` (macOS)
2. Login to Stripe: `stripe login`
3. Forward webhooks: `stripe listen --forward-to http://localhost:3000/webhooks/stripe`
4. Copy webhook secret from CLI output to `.env`: `STRIPE_WEBHOOK_SECRET=whsec_...`
5. Use test API keys: `STRIPE_SECRET_KEY=sk_test_...`
6. Trigger test events: `stripe trigger checkout.session.completed`

### Test Coverage Strategy

**Unit Tests:**

- PlanEnforcementService: limit checking logic, usage counting
- StripeService: mock Stripe SDK, test request construction
- WebhookHandler: idempotency, event routing, state updates

**Integration Tests:**

- Webhook endpoint: signature verification, event processing
- Checkout flow: session creation, redirect handling
- Plan enforcement: end-to-end limit checking in resource creation

**E2E Tests (Stripe Test Mode):**

- Complete upgrade flow: select plan → checkout → webhook → enforced limits
- Trial flow: start trial → 14 days → auto-downgrade
- Payment failure: failed payment → webhook → grace period → access restriction
- Plan changes: upgrade → proration → new limits, downgrade → end-of-period → old limits

### Quality Gates Before Launch

- [ ] All 10 critical pitfalls have prevention code in place
- [ ] Webhook signature verification tested (reject unsigned webhooks)
- [ ] Idempotency tested (send same webhook 3 times, process once)
- [ ] Event ordering tested (send events out of order, verify handled correctly)
- [ ] Payment failure tested (failed payment → access restriction after grace period)
- [ ] Trial end tested (trial expires → auto-downgrade to Free plan)
- [ ] Plan enforcement tested (hit limit → blocked with upgrade CTA)
- [ ] Proration tested (upgrade mid-cycle → preview upcoming invoice)
- [ ] Tax compliance reviewed (Stripe Tax configured for user jurisdictions)
- [ ] Security audit completed (no secret keys in client code, webhook secrets rotated)

## Success Metrics

### Business Metrics (Track from Day 1)

- **Monthly Recurring Revenue (MRR):** Sum of active subscription values
- **Trial Conversion Rate:** % of trials that convert to paid (target: 18-25%)
- **Churn Rate:** % of paying customers who cancel monthly (target: <5%)
- **Revenue per Account (RPA):** Average MRR per paying account
- **Plan Distribution:** % of accounts on Free/Pro/Team

### Technical Metrics (Monitor Continuously)

- **Webhook Processing Time:** P50, P95, P99 latency (target: <500ms P95)
- **Webhook Failure Rate:** % of webhooks that fail processing (target: <0.1%)
- **Payment Success Rate:** % of invoices paid successfully (target: >95%)
- **API Response Time:** Stripe API call latency (target: <1s P95)
- **Enforcement Query Time:** Plan limit check latency (target: <50ms P95)

### User Experience Metrics

- **Time to First Upgrade:** Days from signup to paid conversion
- **Support Tickets (Billing):** Count of billing-related tickets per 100 accounts
- **Cancellation Reasons:** Top 3 reasons customers cancel subscriptions
- **Upgrade Flow Completion:** % who reach checkout who complete payment

## Sources Summary

**Official Documentation (HIGH Confidence):**

- Stripe API Reference, Billing Subscriptions Guide, Webhooks Documentation
- Stripe SDK GitHub repository (versions, compatibility, TypeScript support)
- Stripe CLI Documentation (local testing, webhook forwarding, event triggering)

**Technical Articles (MEDIUM Confidence):**

- Backend.cafe: Fastify + Stripe integration tutorial
- Dev.to: Node.js subscription billing guides (2024)
- Stigg.io: Upgrade/downgrade flows, top 40 SaaS analysis
- Medium: Subscription management, webhook reliability patterns

**Industry Research (MEDIUM Confidence):**

- Maxio, Userpilot, Encharge: Free trial conversion benchmarks (18-25% B2B)
- Chargebee, Togai, Younium: SaaS billing features and patterns
- Upflow, Zuora: Billing software comparison and best practices

**Community Wisdom (LOW-MEDIUM Confidence):**

- GitHub Issues (Fastify + Stripe webhook raw body handling)
- Stack Overflow discussions (webhook signature verification, event ordering)
- Production incident reports (race conditions, idempotency failures)

**Total Sources:** 60+ unique sources across all research files.

---

## Recommendations for Orchestrator

### Immediate Next Steps

1. **Phase 1 Planning:** Use ARCHITECTURE.md "Build Order Dependencies" section to create Phase 1 roadmap (webhook infrastructure)
2. **Data Model Design:** Use ARCHITECTURE.md "Recommended Project Structure" to define Account model extensions
3. **Risk Review:** Share PITFALLS.md with team, prioritize "Critical Pitfalls" for Phase 1 prevention
4. **Stack Setup:** Install packages from STACK.md "Installation" section, configure environment variables

### Phase-Specific Research Needs

- **Phase 1-3:** No additional research needed. Well-documented patterns.
- **Phase 4:** May need deeper research on soft limits, granular resource-specific limits.
- **Phase 5:** May need deeper research on trial conversion optimization, early conversion incentives.
- **Phase 6:** May need deeper research on dunning strategy optimization, retry timing.
- **Phase 7:** May need deeper research on proration edge cases, billing cycle preservation.

### Files to Reference During Roadmap Creation

- **STACK.md:** Technology decisions for each phase
- **FEATURES.md:** Table stakes vs differentiators, MVP vs deferred features
- **ARCHITECTURE.md:** Component structure, build order dependencies
- **PITFALLS.md:** Prevention strategies for each phase, verification checklist

---

_Research complete for: GitLaunch Subscription Billing Milestone_
_Researched: 2026-02-08_
_Confidence: HIGH - All critical areas researched with authoritative sources_
