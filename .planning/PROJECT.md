# GitLaunch

## What This Is

GitLaunch is a SaaS deployment management tool that helps developers and technology stakeholders continuously deliver software. Users connect their GitHub repos, configure deployment workflows, and trigger deployments to staging and production environments — all from a server-rendered HTMX dashboard with real-time status updates.

## Core Value

Developers can deploy their software continuously and reliably through GitLaunch, with a subscription model that lets them start with a free trial and upgrade when they see the value.

## Current Milestone: v1.2 Jenkins CI/CD Provider Support

**Goal:** Support Jenkins as an alternative CI/CD provider alongside GitHub Actions, using a functional-core / imperative-shell architecture so provider-agnostic logic is shared and only the IO differs per provider.

**Target features:**

- Extract a provider-agnostic functional core (deployment status state machine + dispatch-plan derivation) and refactor the GitHub path onto it
- Unify the reporter into one provider-neutral binary (GitHub Action becomes a thin wrapper); server↔reporter status contract pinned by shared golden vectors
- Per-account Jenkins credentials (base URL, username, API token) with the token encrypted at rest
- `JenkinsDispatchService` behind the existing `BuildDispatchServiceI` seam; provider selection via `Service.ciProvider` + job name
- Jenkins status reporting via the shared reporter + onboarding UI (provider picker + pre-filled Jenkinsfile snippet)

## Requirements

### Validated

- ✓ User can authenticate via GitHub OAuth — existing
- ✓ User session persists across browser refresh (JWT cookies) — existing
- ✓ User can create and manage services (CRUD) — existing
- ✓ User can connect GitHub repositories to services — existing
- ✓ User can trigger deployments to environments — existing
- ✓ User sees real-time deployment status via SSE — existing
- ✓ Dashboard displays services and builds with pagination — existing
- ✓ Account-based multi-tenant isolation — existing
- ✓ API key authentication for programmatic access — existing
- ✓ GitHub App integration for webhook-driven builds — existing
- ✓ Reusable GitHub Action (single-step deploy + post-step auto-outcome detection) replaces copy-paste workflow setup — Validated in Phase 5 (CICD-01/02/03)
- ✓ Provider-agnostic functional core for deployment status + dispatch planning — Validated in Phase 6 (PROV-01, PROV-02)

### Active

<!-- v1.2 Jenkins CI/CD Provider Support -->

- [ ] Provider-neutral reporter with shared golden-vector contract; GitHub Action as a thin wrapper (PROV-03)
- [ ] Per-account Jenkins credentials with token encrypted at rest (JENK-01)
- [ ] Per-service provider selection (GitHub Actions vs Jenkins) + Jenkins job name (JENK-02)
- [ ] Dispatch deployments to Jenkins via buildWithParameters (JENK-03)
- [ ] Jenkins pipeline reports status back through the shared reporter (JENK-04)
- [ ] Jenkins onboarding UI: provider picker + pre-filled Jenkinsfile snippet (JENK-05)

- [ ] Subscription system with Free / Pro / Team tiers
- [ ] 14-day free trial on any plan (starts after plan selection)
- [ ] Plan picker shown after signup (before accessing dashboard)
- [ ] Stripe integration behind a MembershipService interface (dependency inversion)
- [ ] Plan enforcement: Free = 3 public repos, 3 services; Pro = more + private repos + environments; Team = unlimited + multiple seats
- [ ] Trial expiry downgrades to Free with read-only access for over-limit resources
- [ ] Settings/billing page showing current plan, usage, and upgrade/downgrade options
- [ ] Stripe Checkout for payment collection
- [ ] Stripe webhook handling for subscription lifecycle events
- [ ] Full signup-to-subscribe flow working end-to-end

### Out of Scope

- Role-based access control — Team tier gets multi-seat first, roles deferred
- Mobile app — web-first
- Custom pricing / enterprise tier — not for initial release
- Annual billing — monthly only for v1
- Multiple payment providers — Stripe only (but interface allows future swaps)

## Context

GitLaunch has an existing codebase with authentication, deployment pipeline, dashboard, and account system fully operational. A StripeService and PlanEnforcementService already exist in the codebase. This milestone focuses on wiring up the subscription flow end-to-end so the product can launch to real users.

The codebase follows layered MVC with dependency injection, MongoDB repositories, and Fastify as the HTTP framework. HTMX drives client-side interactivity. Playwright and Vitest are the testing frameworks.

The development approach is strict TDD: acceptance criteria first, then a Playwright/API e2e test, then red-green-refactor for each story.

## Constraints

- **Tech stack**: Must use existing Fastify + HTMX + MongoDB + Handlebars stack
- **Architecture**: MembershipService must use dependency inversion — interface defines business needs, Stripe is just one implementation
- **Development**: TDD mandatory — failing test first, minimal code to pass, refactor
- **Testing**: Each story starts with acceptance criteria and a Playwright or API e2e test
- **Timeline**: Ship ASAP — full signup-to-subscribe flow required before release

## Key Decisions

| Decision                                            | Rationale                                                                                                          | Outcome   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------- |
| Stripe as payment provider                          | Industry standard for SaaS, good API, handles subscriptions natively                                               | — Pending |
| Interface-first membership                          | Dependency inversion allows swapping providers without changing business logic                                     | — Pending |
| 14-day trial on any plan                            | Builds confidence before asking for payment; generous enough to evaluate                                           | — Pending |
| Read-only on trial expiry                           | Users keep visibility into their setup, creating urgency without destroying their work                             | — Pending |
| Free: 3 repos / 3 services                          | Enough to try it out, not enough for real production work                                                          | — Pending |
| Plan picker after signup                            | Explicit plan choice rather than auto-assigning — user commits to trying a tier                                    | — Pending |
| No credit card for trial                            | Earn trust first by delivering value; payment only when user decides to subscribe                                  | — Pending |
| One trial per GitHub ID                             | Natural abuse prevention — creating new GitHub accounts is high friction; add age checks later if needed           | — Pending |
| Functional core / imperative shell for CI providers | Share provider-agnostic dispatch/status logic; isolate IO per provider so new providers add a shell, not a rewrite | ✓ Phase 6 |
| Jenkins creds per-account (mirror GitHub App)       | Consistent with existing credential model; one Jenkins connection per account                                      | — Pending |
| Jenkins API token encrypted at rest                 | Long-lived secret persisted in Mongo — net-new security surface vs GitHub's non-secret installationId              | — Pending |
| Reporter stays TypeScript (Rust deferred)           | Reuse the just-shipped reporter; revisit a native binary when multi-CI portability pain is concrete                | — Pending |
| Server↔reporter share a contract, not code         | Overlap is only status vocab + outcome mapping + endpoint shapes; pin with shared golden vectors                   | — Pending |

---

_Last updated: 2026-07-12 — Phase 6 complete: provider-agnostic dispatch/status core extracted (PROV-01, PROV-02)_
