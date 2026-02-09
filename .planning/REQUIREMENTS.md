# Requirements: GitLaunch

**Defined:** 2026-02-08
**Core Value:** Developers can deploy their software continuously and reliably through GitLaunch, with a subscription model that lets them start with a free trial and upgrade when they see the value.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Billing Infrastructure

- [ ] **BILL-01**: MembershipService defines a provider-agnostic interface for subscription operations (create, cancel, check status); Stripe is the first implementation
- [ ] **BILL-02**: Webhook endpoint verifies Stripe signatures and processes events idempotently
- [ ] **BILL-03**: Subscription state is cached in MongoDB and updated only via webhooks (Stripe is source of truth)

### Plan Management

- [ ] **PLAN-01**: User sees a plan picker (Free / Pro / Team) after signup, before accessing the dashboard
- [ ] **PLAN-02**: User can subscribe to a paid plan via Stripe Checkout (hosted payment page)
- [ ] **PLAN-03**: User can view a billing settings page showing current plan, usage stats, and Customer Portal link

### Plan Enforcement

- [ ] **ENFC-01**: Server-side limit checks block resource creation when plan limits are exceeded
- [ ] **ENFC-02**: Free tier enforces limits: 3 public repos, 3 services, no private repos
- [ ] **ENFC-03**: Pro tier allows more repos, private repos, and multiple environments
- [ ] **ENFC-04**: Team tier allows unlimited repos/services and multiple seats
- [ ] **ENFC-05**: User sees an upgrade CTA when hitting a plan limit

### Trial Management

- [ ] **TRIL-01**: User gets a 14-day free trial on any paid plan after selecting it
- [ ] **TRIL-02**: Account auto-downgrades to Free when trial expires without subscribing
- [ ] **TRIL-03**: User sees trial countdown showing remaining days in the dashboard
- [ ] **TRIL-04**: Over-limit resources become read-only after downgrade (user can view but not deploy/modify)

### Payment Lifecycle

- [ ] **PYMT-01**: System handles payment failure webhooks and notifies the user
- [ ] **PYMT-02**: User gets a grace period before access is restricted on failed payment

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Self-Service Plan Management

- **MGMT-01**: User can upgrade or downgrade plan mid-cycle with proration preview
- **MGMT-02**: Downgrades take effect at end of billing period

### Notifications

- **NOTF-01**: User receives email notification when trial is about to end (3 days before)
- **NOTF-02**: User receives email when payment fails
- **NOTF-03**: User receives email when subscription changes

### Advanced Features

- **ADVN-01**: Annual billing option with discount
- **ADVN-02**: Team member invites for Team plan
- **ADVN-03**: Role-based access control for team members
- **ADVN-04**: Usage-based overages beyond plan limits
- **ADVN-05**: Proactive upgrade prompts when approaching limits
- **ADVN-06**: Soft limits with grace periods instead of hard blocks

## Out of Scope

| Feature                    | Reason                                             |
| -------------------------- | -------------------------------------------------- |
| Custom payment forms       | Use Stripe Checkout — avoids PCI compliance burden |
| Per-deployment pricing     | Adds complexity, fixed tiers simpler for v1        |
| Multiple payment providers | Stripe only (interface allows future swaps)        |
| Mobile app                 | Web-first                                          |
| Enterprise/custom pricing  | Not needed for initial release                     |
| Annual billing             | Monthly only for v1, trivial to add later          |
| Role-based access          | Team gets multi-seat first, roles deferred to v2   |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase   | Status  |
| ----------- | ------- | ------- |
| BILL-01     | Phase 1 | Pending |
| BILL-02     | Phase 1 | Pending |
| BILL-03     | Phase 1 | Pending |
| PLAN-01     | Phase 2 | Pending |
| PLAN-02     | Phase 2 | Pending |
| PLAN-03     | Phase 2 | Pending |
| ENFC-01     | Phase 3 | Pending |
| ENFC-02     | Phase 3 | Pending |
| ENFC-03     | Phase 3 | Pending |
| ENFC-04     | Phase 3 | Pending |
| ENFC-05     | Phase 3 | Pending |
| TRIL-01     | Phase 4 | Pending |
| TRIL-02     | Phase 4 | Pending |
| TRIL-03     | Phase 4 | Pending |
| TRIL-04     | Phase 4 | Pending |
| PYMT-01     | Phase 4 | Pending |
| PYMT-02     | Phase 4 | Pending |

**Coverage:**

- v1 requirements: 17 total
- Mapped to phases: 17
- Unmapped: 0

---

_Requirements defined: 2026-02-08_
_Last updated: 2026-02-09 after roadmap creation_
