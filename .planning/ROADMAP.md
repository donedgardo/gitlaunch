# Roadmap: GitLaunch Subscription Billing

## Overview

GitLaunch adds a subscription billing system to enable revenue generation through Free/Pro/Team tiers. The journey starts with webhook infrastructure and Stripe integration (Phase 1), enables user upgrades and payment collection (Phase 2), enforces plan limits to create tier value (Phase 3), and completes the lifecycle with trial management and payment failure handling (Phase 4). The end result is a fully operational subscription flow where users can select plans, pay via Stripe, experience enforced limits, try paid tiers risk-free for 14 days, and receive appropriate handling when payments fail.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Billing Foundation** - Webhook infrastructure and Stripe integration ✓
- [x] **Phase 2: Plan Selection & Checkout** - User can select and pay for plans ✓
- [ ] **Phase 3: Plan Enforcement & Limits** - Server-side limit checks enforce tier value (1/2 plans)
- [ ] **Phase 4: Trial & Payment Lifecycle** - Trials, auto-downgrade, payment failure handling

## Phase Details

### Phase 1: Billing Foundation

**Goal**: Stripe webhook infrastructure processes subscription events reliably and updates MongoDB subscription state
**Depends on**: Nothing (first phase)
**Requirements**: BILL-01, BILL-02, BILL-03
**Success Criteria** (what must be TRUE):

1. Webhook endpoint verifies Stripe signatures and rejects unsigned requests
2. Subscription state in MongoDB updates only via webhooks (Stripe is source of truth)
3. Webhook events process idempotently (same event sent twice processes once)
4. MembershipService interface exists with Stripe as first implementation
   **Plans**: 3 plans

Plans:

- [ ] 01-01-PLAN.md — Extract MembershipService interface from StripeService (dependency inversion)
- [ ] 01-02-PLAN.md — WebhookEventRepository with MongoDB unique index for idempotency
- [ ] 01-03-PLAN.md — Wire idempotency + raw body into webhook route and server startup

### Phase 2: Plan Selection & Checkout

**Goal**: User can select a plan after signup (no credit card required) and subscribe later via Stripe Checkout
**Depends on**: Phase 1
**Requirements**: PLAN-01, PLAN-02, PLAN-03
**Notes**: No credit card required for trial. Plan selection starts trial locally (MongoDB). Stripe Checkout only used when user actively subscribes.
**Success Criteria** (what must be TRUE):

1. User sees plan picker (Free/Pro/Team) after signup before accessing dashboard — no payment required
2. User can subscribe to paid plan via Stripe Checkout hosted payment page (when ready)
3. User sees billing settings page showing current plan, usage stats, and Customer Portal link
4. Webhook processes checkout.session.completed and activates subscription
   **Plans**: 3 plans

Plans:

- [x] 02-01-PLAN.md — Expand Plan model to Free/Pro/Team with plan-aware billing services (TDD)
- [x] 02-02-PLAN.md — Plan picker UI in onboarding flow (select plan after signup)
- [x] 02-03-PLAN.md — Billing settings page, Stripe Checkout wiring, and server integration

### Phase 3: Plan Enforcement & Limits

**Goal**: Server-side limit checks block resource creation when plan limits are exceeded
**Depends on**: Phase 2
**Requirements**: ENFC-01, ENFC-02, ENFC-03, ENFC-04, ENFC-05
**Success Criteria** (what must be TRUE):

1. User on Free plan cannot create more than 3 services or 3 public repos
2. User on Free plan sees error with upgrade CTA when hitting limits
3. User on Pro plan can create private repos and multiple environments
4. User on Team plan has no repo/service limits
5. Service layer checks limits before resource creation (not client-side)
   **Plans**: 2 plans

Plans:

- [x] 03-01-PLAN.md — Add environment limit checking to PlanEnforcementService (TDD)
- [ ] 03-02-PLAN.md — Wire enforcement into environment creation endpoints with upgrade CTAs

### Phase 4: Trial & Payment Lifecycle

**Goal**: Users get 14-day no-CC trials on paid plans and system handles trial expiry and payment failures gracefully
**Depends on**: Phase 3
**Requirements**: TRIL-01, TRIL-02, TRIL-03, TRIL-04, PYMT-01, PYMT-02
**Notes**: Trials tracked locally in MongoDB (not Stripe trial periods) since no credit card is collected upfront. One trial per GitHub user ID to prevent abuse. Stripe subscription only created when user actively subscribes.
**Success Criteria** (what must be TRUE):

1. User gets 14-day free trial when selecting paid plan — no credit card required
2. User sees trial countdown showing remaining days in dashboard
3. Account auto-downgrades to Free when trial expires without subscribing
4. Over-limit resources become read-only after downgrade (user can view but not deploy/modify)
5. System processes payment failure webhooks and applies grace period before restriction
6. One trial per GitHub user ID — prevents repeat trial abuse
   **Plans**: 3 plans

Plans:

- [ ] 04-01: Trial management (start trial on plan selection, countdown UI, one-trial-per-GitHub-ID enforcement)
- [ ] 04-02: Auto-downgrade on trial expiry with read-only enforcement for over-limit resources
- [ ] 04-03: Payment failure handling with grace periods and user notifications

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase                        | Plans Complete | Status      | Completed  |
| ---------------------------- | -------------- | ----------- | ---------- |
| 1. Billing Foundation        | 3/3            | ✓ Complete  | 2026-02-09 |
| 2. Plan Selection & Checkout | 3/3            | ✓ Complete  | 2026-02-11 |
| 3. Plan Enforcement & Limits | 1/2            | In progress | -          |
| 4. Trial & Payment Lifecycle | 0/3            | Not started | -          |
