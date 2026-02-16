# Phase 3: Plan Enforcement & Limits - Research

**Researched:** 2026-02-12
**Domain:** Server-side resource limit enforcement with upgrade prompts
**Confidence:** HIGH

## Summary

Phase 3 implements server-side enforcement of plan limits to prevent resource creation when users exceed their plan allowances. The codebase already has a mature `PlanEnforcementService` with comprehensive tests and partial integration into resource creation endpoints. The remaining work involves:

1. Ensuring all resource creation endpoints (repositories, services, environments, users) check limits BEFORE creation
2. Standardizing error responses with upgrade CTAs across HTMX and JSON contexts
3. Handling the boundary cases (e.g., Team plan "unlimited" = 999 limit in practice)

**Primary recommendation:** Integrate existing PlanEnforcementService into all resource creation endpoints using a consistent error response pattern that provides upgrade CTAs. Avoid creating new enforcement logic—the service is already comprehensive and well-tested.

## Standard Stack

### Core

| Library                | Version  | Purpose                                      | Why Standard                                                                               |
| ---------------------- | -------- | -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| PlanEnforcementService | existing | Server-side limit checks and usage reporting | Already implemented with full test coverage (planEnforcementService.test.ts has 477 lines) |
| PlanLimitError         | existing | Custom error type for limit violations       | Includes `upgradeRequired` flag for CTA logic                                              |
| PLAN_LIMITS_MAP        | existing | Centralized plan-to-limits lookup            | Record<Plan, PlanLimits> pattern from accountRepository.ts                                 |

### Supporting

| Library              | Version | Purpose                                       | When to Use                                      |
| -------------------- | ------- | --------------------------------------------- | ------------------------------------------------ |
| Fastify middleware   | 4.x     | Pre-handler hooks for route-level enforcement | When enforcement logic should run before handler |
| HTMX error responses | 1.9.x   | Client-side error display via view re-render  | For form submissions from HTMX-powered UI        |
| HX-Redirect header   | 1.9.x   | Client-side redirects to upgrade flow         | When limit hit should prompt immediate upgrade   |

### Alternatives Considered

| Instead of                 | Could Use                | Tradeoff                                                                       |
| -------------------------- | ------------------------ | ------------------------------------------------------------------------------ |
| Server-side enforcement    | Client-side limit checks | Client-side is spoofable; server-side is source of truth (ENFC-01 requirement) |
| View re-render with error  | Toast notifications      | Re-render preserves form context; toasts require additional UI library         |
| PlanLimitError custom type | Generic Error            | Custom type enables structured handling (upgradeRequired flag, reason message) |

**Installation:**

```bash
# No new dependencies required
# All enforcement logic uses existing services and repositories
```

## Architecture Patterns

### Recommended Project Structure

Current structure already follows best practice:

```
src/
├── services/billing/
│   ├── planEnforcementService.ts      # Core enforcement logic
│   └── planEnforcementService.test.ts # Comprehensive behavior tests
├── repositories/
│   └── accountRepository.ts            # Plan enum, limits constants, PLAN_LIMITS_MAP
├── server/routes/
│   ├── services/index.ts              # Service creation (already enforces)
│   ├── onboarding/index.ts            # Repo creation (already enforces)
│   ├── api/environments.ts            # Environment creation (needs enforcement)
│   └── settings/billing.ts            # Billing settings with upgrade CTA
└── templates/
    ├── services/new.hbs               # Error display pattern (already implemented)
    └── onboarding/select-repos.hbs    # Error display pattern (already implemented)
```

### Pattern 1: Enforcement Before Creation

**What:** Call `planEnforcementService.canAddX()` before creating resource, return error view if limit exceeded
**When to use:** All resource creation endpoints (repositories, services, environments, users)
**Example:**

```typescript
// Source: src/server/routes/services/index.ts lines 134-149 (existing pattern)
// Check plan limit for services
const canAdd = await planEnforcementService.canAddService(account._id);
if (!canAdd.allowed) {
  const repositories = await repositoryRepository.findByAccountId(account._id);
  return reply.view(
    "services/new",
    {
      title: "Create Service",
      repositories,
      error: canAdd.reason, // Includes upgrade message
    },
    { layout: "/layouts/main.hbs" },
  );
}

// Create the service only after check passes
const service = await serviceRepository.create({ ... });
```

### Pattern 2: Dual Response for HTMX/JSON

**What:** Detect `hx-request` header and return appropriate response format
**When to use:** API endpoints that serve both HTMX UI and programmatic clients
**Example:**

```typescript
// Source: src/server/routes/settings/billing.ts lines 134-137 (existing pattern)
const isHtmx = request.headers["hx-request"] === "true";
if (isHtmx) {
  return reply.header("HX-Redirect", session.url).send();
} else {
  return reply.send({ url: session.url });
}
```

### Pattern 3: Usage Display with Upgrade CTA

**What:** Show current usage vs. limits, conditionally render upgrade button based on plan
**When to use:** Dashboard, billing settings, anywhere usage info helps user understand limits
**Example:**

```typescript
// Source: src/server/routes/settings/billing.ts lines 60-90 (existing pattern)
const usage = await planEnforcementService.getUsage(account._id);

return reply.view("settings/billing", {
  usage: {
    repositories: {
      current: usage.repositories.current,
      limit: usage.repositories.limit,
      percentage: Math.round((current / limit) * 100),
    },
    // ... services, users
  },
  hasStripeCustomer: !!account.stripeCustomerId,
});
```

### Anti-Patterns to Avoid

- **Client-side limit checks only:** Server is source of truth (ENFC-01); client checks are UX enhancement only
- **Hardcoded limit values in routes:** Use `PLAN_LIMITS_MAP` and `account.planLimits` from repository
- **Silent failure on limit hit:** Always return explicit error message with upgrade CTA (ENFC-05)
- **Creating resource then checking limits:** Check limits BEFORE creation to avoid rollback complexity
- **Mixing enforcement and business logic:** Keep enforcement in PlanEnforcementService, not scattered in routes

## Don't Hand-Roll

| Problem              | Don't Build                  | Use Instead                            | Why                                                   |
| -------------------- | ---------------------------- | -------------------------------------- | ----------------------------------------------------- |
| Limit checking logic | Custom if/else in each route | PlanEnforcementService methods         | Centralized, tested, consistent across resource types |
| Upgrade flow URLs    | Hardcoded strings            | `/settings/billing` constant or config | Single source of truth for upgrade path               |
| Usage calculations   | Manual count queries         | `planEnforcementService.getUsage()`    | Optimized, consistent, includes all resource types    |
| Error messages       | Ad-hoc strings               | `canAdd.reason` from service           | Consistent wording, includes upgrade guidance         |

**Key insight:** PlanEnforcementService already exists with comprehensive test coverage (477 lines). Don't recreate limit checks—use the service. The service handles:

- Current usage counting (queries repositories/services/memberships)
- Limit lookup (from account.planLimits)
- Private repo restrictions (plan-specific)
- Structured error messages (with upgrade guidance)

## Common Pitfalls

### Pitfall 1: Enforcing Limits After Resource Creation

**What goes wrong:** Route creates resource first, then checks if limit was exceeded, requires rollback/deletion
**Why it happens:** Natural imperative flow: "create then validate" instead of "validate then create"
**How to avoid:** Always call `canAddX()` BEFORE calling `repository.create()`. Pattern: check -> create -> success, not create -> check -> rollback.
**Warning signs:** `try/catch` blocks with `repository.delete()` in catch clause, transaction-like rollback logic

### Pitfall 2: Inconsistent Error Message Format

**What goes wrong:** Some errors say "upgrade to Pro", others say "upgrade your plan", some link to billing, some don't
**Why it happens:** Each developer writes their own error string instead of using service-provided messages
**How to avoid:** Use `canAdd.reason` from PlanEnforcementService as-is. It already includes upgrade guidance ("Upgrade to add more repositories").
**Warning signs:** String interpolation in routes (`\`Limit reached. Please upgrade\``), hardcoded plan names in error messages

### Pitfall 3: Forgetting Team Plan "Unlimited" is Actually 999

**What goes wrong:** Team plan limits set to `Infinity` or no check at all, causing database issues or logic errors
**Why it happens:** Developer assumes "unlimited" means no limit enforcement
**How to avoid:** Team limits are 999 (high but finite). Use `TEAM_PLAN_LIMITS` constant, not custom logic.
**Warning signs:** Special-case `if (plan === Plan.Team) return { allowed: true }` in enforcement code

### Pitfall 4: Only Enforcing on UI, Not API Endpoints

**What goes wrong:** User can bypass limits by calling API directly instead of using UI forms
**Why it happens:** Enforcement added to UI routes (`/services/new`) but not API routes (`/api/services`)
**How to avoid:** Add enforcement to ALL creation endpoints—UI and API. Consider shared middleware or service layer enforcement.
**Warning signs:** Enforcement code only in UI routes, API tests that don't verify limit checking

### Pitfall 5: Not Handling HTMX vs. JSON Response Context

**What goes wrong:** HTMX requests get JSON error responses or vice versa, breaking client-side behavior
**Why it happens:** Endpoint doesn't detect request context (`hx-request` header)
**How to avoid:** Check `request.headers["hx-request"]` and return appropriate format (view render for HTMX, JSON for API).
**Warning signs:** HTMX forms that break on error, API clients that receive HTML instead of JSON

## Code Examples

Verified patterns from official sources:

### Repository Creation with Limit Check (Partial Enforcement)

```typescript
// Source: src/server/routes/onboarding/index.ts lines 238-257
// Get plan usage to check limits
const usage = await planEnforcementService.getUsage(account._id);

// Check if selected count exceeds plan limit
if (selectedRepos.length > usage.repositories.limit) {
  const errorMessage = `Your ${usage.plan} plan allows up to ${usage.repositories.limit} repository. Please select fewer repositories or upgrade your plan.`;
  return reply.view(
    "onboarding/select-repos",
    {
      title: "Select Repositories",
      repositories: availableRepos,
      error: errorMessage,
    },
    { layout: "/layouts/main.hbs" },
  );
}

// Save each selected repo AFTER limit check passes
for (const repo of selectedRepos) {
  await repositoryRepository.create({ ... });
}
```

**Note:** This pattern checks count before bulk creation. For single-resource creation, use `canAddRepository()` instead:

```typescript
// Source: planEnforcementService.ts lines 48-67 (preferred for single creates)
const canAdd = await planEnforcementService.canAddRepository(accountId);
if (!canAdd.allowed) {
  return reply.view("template", { error: canAdd.reason });
}
await repositoryRepository.create({ ... });
```

### Service Creation with Enforcement (Fully Implemented)

```typescript
// Source: src/server/routes/services/index.ts lines 134-149
// Check plan limit for services
const canAdd = await planEnforcementService.canAddService(account._id);
if (!canAdd.allowed) {
  const repositories = await repositoryRepository.findByAccountId(account._id);
  return reply.view(
    "services/new",
    {
      title: "Create Service",
      repositories,
      error: canAdd.reason,
    },
    { layout: "/layouts/main.hbs" },
  );
}

// Create the service
const service = await serviceRepository.create({ ... });
```

### Private Repository Check (Fully Implemented)

```typescript
// Source: src/server/routes/onboarding/index.ts lines 260-275
// Check if any private repos are selected when plan doesn't allow
const hasPrivateRepo = selectedRepos.some((repo) => repo.private);
if (hasPrivateRepo && !usage.privateReposAllowed) {
  const errorMessage =
    "Private repositories require a paid plan. Please select only public repositories or upgrade your plan.";
  return reply.view(
    "onboarding/select-repos",
    {
      title: "Select Repositories",
      repositories: availableRepos,
      error: errorMessage,
    },
    { layout: "/layouts/main.hbs" },
  );
}
```

### Usage Display in Billing Settings

```typescript
// Source: src/server/routes/settings/billing.ts lines 60-90
const usage = await planEnforcementService.getUsage(account._id);

const templateData = {
  plan: account.plan.charAt(0).toUpperCase() + account.plan.slice(1),
  isPaid: account.plan !== Plan.Free,
  hasStripeCustomer: !!account.stripeCustomerId,
  usage: {
    repositories: {
      current: usage.repositories.current,
      limit: usage.repositories.limit,
      percentage: Math.round(
        (usage.repositories.current / usage.repositories.limit) * 100,
      ),
    },
    services: {
      /* same pattern */
    },
    users: {
      /* same pattern */
    },
  },
};

return reply.view("settings/billing", templateData);
```

### Error Template Pattern

```handlebars
{{! Source: src/templates/services/new.hbs lines 35-45 }}
{{#if error}}
  <div
    class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl"
  >
    <div style="display: flex;">
      <svg
        style="width: 20px; height: 20px; min-width: 20px;"
        class="text-red-600 dark:text-red-400 mt-0.5 mr-3"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        ></path>
      </svg>
      <p class="text-sm text-red-800 dark:text-red-200">{{error}}</p>
    </div>
  </div>
{{/if}}
```

## State of the Art

| Old Approach             | Current Approach                            | When Changed                  | Impact                                                   |
| ------------------------ | ------------------------------------------- | ----------------------------- | -------------------------------------------------------- |
| Client-side limit checks | Server-side enforcement as source of truth  | Industry standard since ~2010 | Security: prevents bypass via API/DevTools               |
| Generic Error class      | Custom PlanLimitError with metadata         | Domain-driven design pattern  | Enables structured error handling (upgradeRequired flag) |
| Hardcoded limits in code | Database-stored limits (account.planLimits) | Phase 2 (02-01)               | Allows runtime plan changes without code deploy          |
| Binary Free/Paid         | Multi-tier Free/Pro/Team                    | Phase 2 (02-01)               | Pricing flexibility, clearer value proposition           |

**Deprecated/outdated:**

- **Client-side-only enforcement:** Never acceptable for SaaS billing—trivial to bypass
- **Limits as magic numbers:** Use named constants from PLAN_LIMITS_MAP
- **Binary plan checks:** Use Plan enum (Free/Pro/Team), not boolean isPaid

## Open Questions

1. **Environment creation enforcement**

   - What we know: Free plan gets 1 environment (staging), Pro/Team get multiple
   - What's unclear: Should this be enforced in EnvironmentService or route handler? Current pattern (services/repos) enforces in route.
   - Recommendation: Follow existing pattern—enforce in route handler (`POST /api/environments` or equivalent), not in EnvironmentService

2. **User/member invitation enforcement**

   - What we know: Free allows 1 user, Pro allows 5, Team allows 999
   - What's unclear: No member invitation endpoint exists yet (v2 requirement ADVN-02)
   - Recommendation: No action needed for Phase 3. When invitation flow is added, use `planEnforcementService.canAddUser()` before creating membership

3. **Upgrade CTA link destination**

   - What we know: Error messages say "Upgrade to add more X"
   - What's unclear: Should link go to `/settings/billing` (current pattern) or directly to checkout?
   - Recommendation: Link to `/settings/billing`. User can see current usage and choose plan. Billing page already has upgrade flow (Phase 2).

4. **Over-limit resources after downgrade**
   - What we know: TRIL-04 requires read-only access for over-limit resources
   - What's unclear: Phase 3 only blocks NEW resource creation. Phase 4 handles downgrade/trial expiry.
   - Recommendation: Out of scope for Phase 3. Phase 4 will handle grace period and read-only enforcement.

## Sources

### Primary (HIGH confidence)

- **Codebase analysis:**
  - `src/services/billing/planEnforcementService.ts` (198 lines) - Full implementation with 4 can* methods and 4 enforce* methods
  - `src/services/billing/planEnforcementService.test.ts` (477 lines) - Comprehensive behavior tests covering all plans and resource types
  - `src/repositories/accountRepository.ts` lines 3-62 - Plan enum, PlanLimits type, tier-specific constants, PLAN_LIMITS_MAP
  - `src/server/routes/services/index.ts` lines 134-149 - Service creation enforcement (fully implemented)
  - `src/server/routes/onboarding/index.ts` lines 238-275 - Repository enforcement (partial—batch check, not per-repo)
  - `src/server/routes/settings/billing.ts` lines 60-90 - Usage display pattern
  - `.planning/REQUIREMENTS.md` lines 22-28 - ENFC-01 through ENFC-05 requirements
  - `.planning/phases/02-plan-selection-checkout/02-VERIFICATION.md` - Phase 2 completion status (12/12 verified)

### Secondary (MEDIUM confidence)

- **Architectural patterns:**
  - Fastify middleware pattern for pre-handler enforcement: `src/server/middleware/accountContext.ts` (74 lines)
  - HTMX error response pattern: `src/templates/services/new.hbs` lines 35-45
  - Dual HTMX/JSON response: `src/server/routes/settings/billing.ts` lines 134-137

### Tertiary (LOW confidence)

- None required—all findings verified from codebase and existing implementation

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - PlanEnforcementService fully implemented and tested
- Architecture: HIGH - Existing enforcement patterns in services and onboarding routes
- Pitfalls: HIGH - Based on common SaaS billing enforcement issues and codebase analysis

**Research date:** 2026-02-12
**Valid until:** 30 days (stable domain—billing enforcement patterns rarely change)

**Key findings:**

1. PlanEnforcementService is mature and comprehensive (198 lines implementation, 477 lines tests)
2. Two routes already enforce limits: services/new (full enforcement) and onboarding/repositories (partial enforcement)
3. Environment creation endpoint exists but lacks enforcement
4. Error display pattern is consistent (view re-render with error prop, Handlebars conditional rendering)
5. Upgrade CTA is implicit in error messages ("Upgrade to add more X") but not explicit link
6. No new libraries or patterns needed—integrate existing service into remaining endpoints
