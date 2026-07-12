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

## v1.2 Requirements — Jenkins CI/CD Provider Support

Scoped to milestone v1.2. Continues numbering; phases 06–10.

### Provider Abstraction

- [x] **PROV-01
      **: Deployment status logic (outcome→status mapping, legal transitions) lives in a single provider-agnostic core used by both the server and the reporter
- [x] **PROV-02
      **: Deployment dispatch is computed as a provider-agnostic plan; GitHub Actions dispatch runs through it with no observable behavior change (existing tests stay green)
- [ ] **PROV-03**: The reporter is provider-neutral and the GitHub Action is a thin wrapper over it; a shared golden-vector fixture keeps the server↔reporter status contract in lockstep

### Jenkins Provider

- [ ] **JENK-01**: User can connect a Jenkins server to their account (base URL, username, API token); the token is encrypted at rest and never rendered back to the UI
- [ ] **JENK-02**: User can configure a service to deploy via Jenkins (select provider + job name) instead of GitHub Actions
- [ ] **JENK-03**: Launchpad dispatches a deployment to Jenkins via `buildWithParameters` when a deploy is triggered on a Jenkins-configured service
- [ ] **JENK-04**: A Jenkins pipeline reports deployment status back to Launchpad via the shared reporter (deploying → deployed/error/cancelled)
- [ ] **JENK-05**: User sees a Jenkins setup guide (provider picker + pre-filled Jenkinsfile snippet) in service onboarding/settings

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

### Multi-Provider CI/CD (future)

- **PROV-04**: Standalone native (Rust) reporter binary for dependency-free portability across arbitrary CI agents — deferred until multi-CI portability pain is concrete
- **PROV-05**: Additional CI providers (GitLab CI, CircleCI, etc.) reusing the same functional-core / imperative-shell seam

## Out of Scope

| Feature                         | Reason                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------- |
| Custom payment forms            | Use Stripe Checkout — avoids PCI compliance burden                               |
| Per-deployment pricing          | Adds complexity, fixed tiers simpler for v1                                      |
| Multiple payment providers      | Stripe only (interface allows future swaps)                                      |
| Mobile app                      | Web-first                                                                        |
| Enterprise/custom pricing       | Not needed for initial release                                                   |
| Annual billing                  | Monthly only for v1, trivial to add later                                        |
| Role-based access               | Team gets multi-seat first, roles deferred to v2                                 |
| Rust reporter binary (v1.2)     | Keep the TS reporter for now; revisit for portability across arbitrary CI agents |
| Jenkins per-service credentials | One Jenkins connection per account for v1.2 (mirrors GitHub App model)           |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase    | Status   |
| ----------- | -------- | -------- |
| BILL-01     | Phase 1  | Pending  |
| BILL-02     | Phase 1  | Pending  |
| BILL-03     | Phase 1  | Pending  |
| PLAN-01     | Phase 2  | Pending  |
| PLAN-02     | Phase 2  | Pending  |
| PLAN-03     | Phase 2  | Pending  |
| ENFC-01     | Phase 3  | Pending  |
| ENFC-02     | Phase 3  | Pending  |
| ENFC-03     | Phase 3  | Pending  |
| ENFC-04     | Phase 3  | Pending  |
| ENFC-05     | Phase 3  | Pending  |
| TRIL-01     | Phase 4  | Pending  |
| TRIL-02     | Phase 4  | Pending  |
| TRIL-03     | Phase 4  | Pending  |
| TRIL-04     | Phase 4  | Pending  |
| PYMT-01     | Phase 4  | Pending  |
| PYMT-02     | Phase 4  | Pending  |
| CICD-01     | Phase 5  | Complete |
| CICD-02     | Phase 5  | Complete |
| CICD-03     | Phase 5  | Complete |
| PROV-01     | Phase 6  | Pending  |
| PROV-02     | Phase 6  | Pending  |
| PROV-03     | Phase 7  | Pending  |
| JENK-01     | Phase 8  | Pending  |
| JENK-02     | Phase 8  | Pending  |
| JENK-03     | Phase 9  | Pending  |
| JENK-04     | Phase 10 | Pending  |
| JENK-05     | Phase 10 | Pending  |

**Coverage:**

- v1.0 requirements: 20 total — mapped, all complete
- v1.2 requirements: 8 total (PROV-01/02/03, JENK-01/02/03/04/05) — mapped to phases 6–10
- Unmapped: 0

---

_Requirements defined: 2026-02-08_
_Last updated: 2026-07-12 — Milestone v1.2 (Jenkins CI/CD) requirements defined and mapped to phases 6–10_
