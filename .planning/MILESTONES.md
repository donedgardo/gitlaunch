# Project Milestones: GitLaunch

## v1.1 Dashboard & Environment Management (Shipped: 2026-02-04)

**Delivered:** Fixed critical SSE bugs and added user-configurable environment management

**Phases completed:** 3 features (TDD cycles)

**Key accomplishments:**

- Fixed SSE event format mismatch (build updates now reach browser)
- Auto-configure workflows on first deployment (no more stuck onboarding)
- Full environment management API (CRUD endpoints)
- Settings UI with HTMX modals for environment add/edit/delete
- E2E acceptance tests with clear success criteria

**Stats:**

- 15+ files created/modified
- ~800 lines of TypeScript added
- 318 unit tests passing (+40 new)
- E2E acceptance tests for environments
- 1 evening from start to ship

**Git range:** `1ce7f30` → `7ba4c75`

**What's next:** Validate E2E tests in CI, then continue with dashboard improvements

---

## v1.0 Multi-Tenant SaaS (Shipped: 2026-01-17)

**Delivered:** Complete multi-tenant transformation with GitHub App, Stripe billing, and onboarding

**Phases completed:** 6 phases (see docs/MULTI_TENANT_PLAN.md)

**Key accomplishments:**

- GitHub OAuth replacing Google OAuth
- GitHub App integration for repo access
- Stripe billing with plan enforcement
- API key authentication system
- Landing page and onboarding flow
- 262+ tests passing

**What's next:** Dashboard improvements and environment management (v1.1)

---
