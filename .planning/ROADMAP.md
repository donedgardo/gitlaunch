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
- [x] **Phase 3: Plan Enforcement & Limits** - Server-side limit checks enforce tier value ✓
- [x] **Phase 4: Trial & Payment Lifecycle** - Trials, auto-downgrade, payment failure handling ✓
- [x] **Phase 5: Simplify CI/CD Pipeline Setup with GitHub Action** - Reusable GitHub Action to replace copy-paste workflow setup ✓

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
   **Plans**: 3 plans

Plans:

- [x] 03-01-PLAN.md — Add environment limit checking to PlanEnforcementService (TDD)
- [x] 03-02-PLAN.md — Wire enforcement into environment creation endpoints with upgrade CTAs
- [x] 03-03-PLAN.md — Gap closure: Wire canAddPrivateRepository into repository creation and fix batch limit check (TDD)

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

**Plans**: 4 plans

Plans:

- [x] 04-01-PLAN.md — Trial management core: TrialRegistryRepository, Account schema extension, TrialService (TDD)
- [x] 04-02-PLAN.md — Wire trial into onboarding + dashboard, auto-downgrade on expiry, read-only state, countdown UI (TDD)
- [x] 04-03-PLAN.md — Payment failure grace periods with UI warnings on dashboard and billing settings (TDD)
- [x] 04-04-PLAN.md — Gap closure: Add TrialRegistryRepository.ensureIndexes() to server startup

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase                                               | Plans Complete | Status     | Completed  |
| --------------------------------------------------- | -------------- | ---------- | ---------- |
| 1. Billing Foundation                               | 3/3            | ✓ Complete | 2026-02-09 |
| 2. Plan Selection & Checkout                        | 3/3            | ✓ Complete | 2026-02-11 |
| 3. Plan Enforcement & Limits                        | 3/3            | ✓ Complete | 2026-02-15 |
| 4. Trial & Payment Lifecycle                        | 4/4            | ✓ Complete | 2026-02-16 |
| 5. Simplify CI/CD Pipeline Setup with GitHub Action | 2/2            | ✓ Complete | 2026-07-11 |

### Phase 5: Simplify CI/CD Pipeline Setup with GitHub Action

**Goal:** Minimize friction when setting up a CI/CD pipeline by abstracting the current copy-paste workflow YAML into a reusable GitHub Action published on the marketplace
**Depends on:** Phase 4
**Notes:** Existing action lives at donedgardo/build-reporter. Should be added as a submodule of this repo called `github-action`. Users should be able to set up CI/CD with minimal configuration instead of copying a massive workflow file.
**Requirements:** CICD-01, CICD-02, CICD-03
**Plans:** 2 plans

Plans:

- [x] 05-01-PLAN.md — Consolidated GitHub Action with post-step auto-outcome detection (TDD)
- [x] 05-02-PLAN.md — Dashboard templates and workflow migration to consolidated action

---

## Milestone v1.2 — Jenkins CI/CD Provider Support

**Goal:** Support Jenkins as an alternative CI/CD provider alongside GitHub Actions using a functional-core / imperative-shell architecture. Provider-agnostic dispatch and status logic is shared across the server and the reporter; only the per-provider IO differs. The receiving/status-callback API (`PATCH /api/v1/services/:id/builds/:buildId/deploy/:env`) and the deployment status model are already provider-agnostic — no server-side status/API changes needed.

**Continues phase numbering from v1.0 (ended at Phase 5). v1.2 = Phases 6–10.**

### Phases (v1.2)

- [ ] **Phase 6: Extract provider-agnostic dispatch core** - Pure deployStatus + planDispatch core; GitHub path refactored onto it, behavior unchanged
- [ ] **Phase 7: Unify the provider-neutral reporter** - Reporter sits on the shared status core behind a golden-vector contract; GitHub Action becomes a thin wrapper
- [ ] **Phase 8: Per-account Jenkins credentials + provider selection** - Connect Jenkins (URL/user/encrypted token) and pick provider per service
- [ ] **Phase 9: JenkinsDispatchService** - Dispatch deployments to Jenkins via buildWithParameters behind BuildDispatchServiceI
- [ ] **Phase 10: Jenkins reporting path + onboarding** - Jenkinsfile snippet reports back through the shared reporter; provider-picker onboarding UI

## Phase Details (v1.2)

### Phase 6: Extract provider-agnostic dispatch core

**Goal**: A pure functional core owns deployment-status transitions and dispatch planning, and the existing GitHub Actions path runs entirely through it with no observable behavior change
**Depends on**: Nothing new (refactor of existing GitHub path; builds on Phase 5's dispatch/reporter work)
**Requirements**: PROV-01, PROV-02
**Notes**: Extract a pure `deployStatus` module (outcome `success|failure|cancelled` → status; legal transitions `dispatching → deploying → deployed/error/cancelled`, currently implicit in `BuildService.updateDeploymentStatus` and duplicated in `github-action/src/post.ts`) and a pure `planDispatch((service, providerConfig, build, environment) → DispatchPlan {kind:'github'|'jenkins',...} | ValidationError)`. Reuse the existing `BuildDispatchServiceI` seam (`src/services/build/buildDispatchService.ts`); `BuildService` stays untouched. TDD — pure core is tested without mocks.
**Success Criteria** (what must be TRUE):

1. A pure `deployStatus` module maps outcomes to statuses and rejects illegal transitions, covered by unit tests that use no mocks
2. A pure `planDispatch` function returns a `DispatchPlan` (or a `ValidationError`) from `(service, providerConfig, build, environment)` without performing any IO
3. GitHub Actions dispatch runs through `planDispatch` with identical observable behavior — a deploy still triggers the same workflow_dispatch as before
4. All existing build/dispatch/status tests remain green

**Plans**: TBD
**UI hint**: no

### Phase 7: Unify the provider-neutral reporter

**Goal**: The reporter's status reporting is provider-neutral and rides on the shared status core, with the GitHub Action reduced to a thin wrapper, and the server↔reporter contract is pinned by a shared golden-vector fixture
**Depends on**: Phase 6
**Requirements**: PROV-03
**Notes**: Refactor the `github-action` reporter so its report-build/deploy and outcome-detection logic sits on the shared status core; the GitHub Action becomes a thin wrapper. Add a shared golden-vector fixture (JSON) that BOTH the server tests and the reporter tests load to keep the status vocabulary, outcome mapping, and REST endpoint shapes in lockstep. Reporter stays TypeScript (Rust deferred). The shared core lives in the main repo; the `github-action` submodule vendors it behind a golden-vector contract test (exact vendoring mechanism settled at plan time).
**Success Criteria** (what must be TRUE):

1. The reporter derives status/outcome from the shared core rather than its own duplicated logic
2. The GitHub Action is a thin wrapper over the provider-neutral reporter with no status logic of its own
3. A shared golden-vector JSON fixture is loaded by both server tests and reporter tests, and a contract test fails if their status vocabulary, outcome mapping, or endpoint shapes drift
4. GitHub Action deploy reporting behavior is unchanged and existing reporter tests pass

**Plans**: TBD
**UI hint**: no

### Phase 8: Per-account Jenkins credentials + provider selection

**Goal**: A user can connect a Jenkins server to their account with the API token stored securely, and choose Jenkins (vs GitHub Actions) as the CI provider for a service
**Depends on**: Phase 5's provider/credential model (mirrors GitHub App installation); can proceed independently of Phases 6/7
**Requirements**: JENK-01, JENK-02
**Notes**: Add a per-account Jenkins connection (base URL, username, API token) mirroring the GitHub App installation model. The API token is a long-lived secret — it MUST be encrypted at rest and never rendered back to the UI (net-new security surface vs GitHub's non-secret `installationId`). Add a `Service.ciProvider` discriminator (`'github' | 'jenkins'`) plus `jobName`. UI to connect Jenkins and choose the provider per service.
**Success Criteria** (what must be TRUE):

1. User can save a Jenkins connection (base URL, username, API token) for their account
2. The stored Jenkins API token is encrypted at rest and is never rendered back into the settings UI (shown masked / never echoed)
3. User can set a service's `ciProvider` to Jenkins and specify its `jobName`, or leave it as GitHub Actions
4. Persisted `ciProvider` + `jobName` are readable by the dispatch layer for later use

**Plans**: TBD
**UI hint**: yes

### Phase 9: JenkinsDispatchService

**Goal**: Triggering a deploy on a Jenkins-configured service dispatches the build to Jenkins via `buildWithParameters`, selected automatically by the provider discriminator
**Depends on**: Phase 6 (`planDispatch`) and Phase 8 (credentials + `ciProvider`)
**Requirements**: JENK-03
**Notes**: Implement `JenkinsDispatchService` behind `BuildDispatchServiceI` — basic auth (`user:apiToken`) → `POST {baseUrl}/job/{job}/buildWithParameters` with `buildId`/`environment`/`serviceId` as job params; handle the Jenkins CSRF crumb; jobs must accept remote params. Wire provider selection into the dispatch factory (`src/server/createAppServer.ts`). Jenkins `buildWithParameters` is async-with-callback, structurally identical to GitHub `workflow_dispatch`.
**Success Criteria** (what must be TRUE):

1. Triggering a deploy on a Jenkins service issues `POST {baseUrl}/job/{job}/buildWithParameters` with `buildId`, `environment`, and `serviceId` as parameters
2. The request authenticates with basic auth (`user:apiToken`) and includes a valid Jenkins CSRF crumb
3. The dispatch factory routes to `JenkinsDispatchService` for Jenkins services and to the GitHub path for GitHub services, driven by `ciProvider`
4. A successful Jenkins dispatch transitions the deployment to `dispatching`/`deploying` via the shared status core (no GitHub-only behavior change)

**Plans**: TBD
**UI hint**: no

### Phase 10: Jenkins reporting path + onboarding

**Goal**: A Jenkins pipeline reports deployment status back to Launchpad through the shared reporter, and users have onboarding that lets them pick the provider and copy a pre-filled Jenkinsfile snippet
**Depends on**: Phase 7 (shared reporter) and Phase 9 (Jenkins dispatch)
**Requirements**: JENK-04, JENK-05
**Notes**: Provide a parameterized Jenkinsfile snippet that invokes the shared reporter to report status back (`deploying → deployed/error/cancelled`). Add onboarding/settings UI with a provider picker and pre-filled Jenkinsfile snippet, mirroring `src/templates/partials/deploymentSetupGuide.hbs`.
**Success Criteria** (what must be TRUE):

1. A Jenkins pipeline running the provided Jenkinsfile snippet reports status back through the shared reporter, moving the build `deploying → deployed/error/cancelled` in the dashboard
2. The service onboarding/settings UI shows a provider picker (GitHub Actions vs Jenkins)
3. When Jenkins is selected, the UI shows a pre-filled Jenkinsfile snippet (parameterized with the service/job values) the user can copy
4. An end-to-end Jenkins deploy — dispatch through report-back — is observable in the dashboard just like a GitHub deploy

**Plans**: TBD
**UI hint**: yes

## Progress (v1.2)

**Execution Order:**
Phases execute in numeric order: 6 → 7 → 8 → 9 → 10

| Phase                                          | Plans Complete | Status      | Completed |
| ---------------------------------------------- | -------------- | ----------- | --------- |
| 6. Extract provider-agnostic dispatch core     | 0/TBD          | Not started | -         |
| 7. Unify the provider-neutral reporter         | 0/TBD          | Not started | -         |
| 8. Per-account Jenkins credentials + selection | 0/TBD          | Not started | -         |
| 9. JenkinsDispatchService                      | 0/TBD          | Not started | -         |
| 10. Jenkins reporting path + onboarding        | 0/TBD          | Not started | -         |
