# Architecture Research: SaaS Subscription Billing

**Domain:** SaaS Subscription Billing & Plan Enforcement
**Researched:** 2026-02-08
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     PRESENTATION LAYER                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   HTMX       │  │   Billing    │  │   Webhook    │          │
│  │   Pages      │  │   Portal     │  │   Endpoint   │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                  │                  │                  │
├─────────┴──────────────────┴──────────────────┴──────────────────┤
│                     ROUTE HANDLERS LAYER                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Dashboard   │  │   Settings   │  │   Stripe     │          │
│  │   Routes     │  │   Routes     │  │   Webhook    │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                  │                  │                  │
├─────────┴──────────────────┴──────────────────┴──────────────────┤
│                      SERVICES LAYER                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │    Plan      │  │    Stripe    │  │   Webhook    │          │
│  │ Enforcement  │  │   Service    │  │   Handler    │          │
│  │   Service    │  │              │  │              │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                  │                  │                  │
│         └──────────────────┴──────────────────┘                  │
│                            ↓                                     │
├─────────────────────────────────────────────────────────────────┤
│                    REPOSITORY LAYER                              │
│  ┌────────────────────────────────────────────────────────┐     │
│  │              AccountRepository                          │     │
│  │  - Plan state (Free/Paid)                              │     │
│  │  - Plan limits                                         │     │
│  │  - Stripe metadata (customerId, subscriptionId)       │     │
│  │  - Trial/Payment failure timestamps                   │     │
│  └────────────────────────┬───────────────────────────────┘     │
│                            ↓                                     │
├─────────────────────────────────────────────────────────────────┤
│                      DATA LAYER                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   MongoDB    │  │    Stripe    │  │   External   │          │
│  │   accounts   │  │     API      │  │   Webhooks   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component                  | Responsibility                                                                                      | Typical Implementation                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **PlanEnforcementService** | Guard all resource creation (repos, services, users) against plan limits; provide usage info for UI | Dependency injection, coordinates 4+ repositories to count resources and check limits |
| **StripeService**          | Create checkout sessions, billing portal sessions, fetch subscription status                        | Wraps Stripe SDK behind interface, allows testing with mocks                          |
| **WebhookHandler**         | Process Stripe events (checkout completed, subscription changes, payment failures)                  | Event handlers that update account state via repository                               |
| **AccountRepository**      | Store plan state, limits, Stripe IDs, trial/payment metadata                                        | MongoDB collection with upgrade/downgrade operations                                  |
| **MembershipService**      | Abstract billing provider (Stripe is one implementation)                                            | Interface for multiple billing providers (future PayPal/etc)                          |

## Recommended Project Structure

```
src/
├── services/
│   ├── billing/
│   │   ├── planEnforcementService.ts      # Limit checks before resource creation
│   │   ├── stripeService.ts               # Stripe API wrapper (create checkout, portal)
│   │   ├── webhookHandler.ts              # Event processing (upgrade, downgrade, payment)
│   │   ├── stripeSignatureVerifier.ts     # Security (HMAC verification)
│   │   ├── membershipService.ts           # Interface for billing providers
│   │   └── trialManager.ts                # Trial lifecycle (start, end, auto-downgrade)
│   ├── account/
│   │   └── accountMembershipService.ts    # Account-level membership operations
├── repositories/
│   ├── accountRepository.ts               # Plan state, limits, Stripe metadata
│   ├── subscriptionRepository.ts          # Subscription history, usage events
├── server/
│   ├── routes/
│   │   ├── settings/
│   │   │   └── billing.ts                 # Billing portal, upgrade CTA, usage display
│   │   └── webhooks/
│   │       └── stripe.ts                  # Webhook endpoint (POST /webhooks/stripe)
│   └── middleware/
│       └── planEnforcement.ts             # Pre-handler hook for plan checks
```

### Structure Rationale

- **services/billing/:** Centralizes all billing logic separate from core domain services (builds, repositories)
- **Webhook isolation:** Separate route handler because webhooks bypass normal auth (verified via signature)
- **Repository abstraction:** Account stores ALL billing state to maintain single source of truth
- **Middleware option:** Plan enforcement can be middleware (automatic) or explicit service calls (more control)

## Architectural Patterns

### Pattern 1: Dependency Inversion for Billing Providers

**What:** Define `MembershipService` interface, implement with `StripeService`. Core services depend on interface, not Stripe SDK.

**When to use:** When you want flexibility to add additional payment providers (PayPal, in-house billing) without rewriting core logic.

**Trade-offs:**

- PRO: Testability (mock interface), provider flexibility, clear boundaries
- CON: Extra abstraction layer, more files to maintain
- VERDICT: Worth it for SaaS products (providers change, testing critical)

**Example:**

```typescript
// Interface in services/billing/membershipService.ts
export interface MembershipService {
  createCheckoutSession(account: Account): Promise<{ url: string }>;
  getBillingPortalUrl(account: Account): Promise<string>;
  getSubscriptionStatus(account: Account): Promise<SubscriptionStatus | null>;
}

// Implementation in services/billing/stripeService.ts
export class StripeService implements MembershipService {
  constructor(private stripeClient: StripeClient) {}

  async createCheckoutSession(account: Account): Promise<{ url: string }> {
    // Stripe-specific implementation
  }
}

// Usage in route handler
async function handleUpgradeClick(
  membershipService: MembershipService,
  account: Account,
) {
  const { url } = await membershipService.createCheckoutSession(account);
  reply.redirect(url);
}
```

### Pattern 2: Event-Driven State Updates via Webhooks

**What:** Stripe sends webhook events for subscription changes. Application responds quickly (200 OK), processes event asynchronously, updates database state.

**When to use:** Always for subscription billing. Webhooks are source of truth for payment status, not application state.

**Trade-offs:**

- PRO: Reliable state sync, handles async payments (ACH), retry-safe
- CON: Eventual consistency (webhook delay before state updates), debugging harder
- VERDICT: Non-negotiable for production SaaS billing

**Example:**

```typescript
// Webhook route handler
app.post("/webhooks/stripe", async (request, reply) => {
  const event = verifyStripeSignature(
    request.body,
    request.headers["stripe-signature"],
  );

  // Respond immediately (Stripe retries if not 200 within seconds)
  reply.status(200).send({ received: true });

  // Process asynchronously (queue or immediate)
  switch (event.type) {
    case "checkout.session.completed":
      await webhookHandler.handleCheckoutCompleted(event.data);
      break;
    case "customer.subscription.deleted":
      await webhookHandler.handleSubscriptionDeleted(event.data);
      break;
  }
});
```

### Pattern 3: Plan Enforcement at Service Boundaries

**What:** Before creating resources (repos, services, users), call `PlanEnforcementService.enforceXLimit(accountId)` which throws `PlanLimitError` if exceeded.

**When to use:** Every user-initiated action that consumes quota (not reads, only writes that create billable entities).

**Trade-offs:**

- PRO: Centralized logic, consistent enforcement, clear error messages
- CON: Extra database queries (count resources), requires passing accountId everywhere
- VERDICT: Essential for freemium/tiered SaaS. Cost is worth consistency.

**Example:**

```typescript
// In service layer (e.g., RepositoryService.connectRepository)
async connectRepository(accountId: ObjectId, githubRepo: GitHubRepo): Promise<Repository> {
  // Check limits BEFORE creating
  await this.planEnforcement.enforceRepositoryLimit(accountId);

  if (githubRepo.private) {
    await this.planEnforcement.enforcePrivateRepoLimit(accountId);
  }

  // Proceed with creation
  return this.repoRepository.create({ accountId, ...githubRepo });
}
```

### Pattern 4: Trial Lifecycle State Machine

**What:** Trial period tracked via `trialEndsAt` timestamp on Account. Background job checks expired trials, auto-downgrades to Free plan.

**When to use:** When offering time-limited trials (14-day Pro trial) that automatically revert to Free.

**Trade-offs:**

- PRO: Automatic conversion funnel, no user action required, clear expiration
- CON: Requires background job (cron/queue), timestamp management, grace period decisions
- VERDICT: Standard for SaaS. Use scheduled job (not webhook-only).

**Example:**

```typescript
// Account model
type Account = {
  plan: Plan;
  trialEndsAt: Date | null; // null = not in trial
  planLimits: PlanLimits;
};

// Background job (runs hourly)
async function processExpiredTrials(accountRepo: AccountRepository) {
  const expiredAccounts = await accountRepo.findTrialsEndedBefore(new Date());

  for (const account of expiredAccounts) {
    if (!account.stripeSubscriptionId) {
      // Not subscribed
      await accountRepo.downgradeToFree(account._id);
    }
  }
}

// When starting trial
async function startTrial(accountId: ObjectId) {
  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + 14); // 14 days

  await accountRepo.updateTrial(accountId, {
    plan: Plan.Trial,
    planLimits: PRO_PLAN_LIMITS,
    trialEndsAt,
  });
}
```

### Pattern 5: Idempotent Webhook Processing

**What:** Stripe may send duplicate webhooks. Use event ID to deduplicate or design handlers to be idempotent (same result if run multiple times).

**When to use:** All webhook handlers. Duplicates happen during network issues, retries, or Stripe infrastructure.

**Trade-offs:**

- PRO: Prevents double-charging, duplicate downgrades, data corruption
- CON: Extra database table (processed_events), complexity in every handler
- VERDICT: Critical for production. Use event ID storage or natural idempotency.

**Example:**

```typescript
// Approach 1: Store processed event IDs
async handleCheckoutCompleted(event: CheckoutCompletedEvent, eventId: string): Promise<void> {
  const alreadyProcessed = await this.eventRepo.findById(eventId);
  if (alreadyProcessed) return;  // Skip duplicate

  await this.accountRepo.upgradeToPaid(event.accountId, event.customerId, event.subscriptionId);
  await this.eventRepo.markProcessed(eventId);
}

// Approach 2: Natural idempotency (safer, no extra table)
async handleCheckoutCompleted(event: CheckoutCompletedEvent): Promise<void> {
  // upgradeToPaid is idempotent (sets fields to same value if run twice)
  await this.accountRepo.upgradeToPaid(event.accountId, event.customerId, event.subscriptionId);
  // No side effects besides database update = naturally idempotent
}
```

## Data Flow

### Request Flow: User Clicks "Upgrade to Pro"

```
User clicks "Upgrade" button
    ↓
HTMX: POST /settings/billing/upgrade
    ↓
Route Handler:
  - Get authenticated user & account from session
  - Call StripeService.createCheckoutSession(account)
    ↓
StripeService:
  - Create Stripe Checkout Session (account metadata)
  - Return checkout URL
    ↓
Route Handler:
  - Redirect user to Stripe Checkout
    ↓
User completes payment on Stripe
    ↓
Stripe sends webhook: checkout.session.completed
    ↓
POST /webhooks/stripe (signature verified)
    ↓
WebhookHandler.handleCheckoutCompleted():
  - Extract accountId, customerId, subscriptionId
  - Call AccountRepository.upgradeToPaid()
    ↓
AccountRepository.upgradeToPaid():
  - Update account: plan=Paid, planLimits=PRO_LIMITS
  - Store Stripe IDs for future reference
  - Clear trial/payment failure flags
    ↓
User redirected to success page
    ↓
Next page load: Dashboard shows Pro features unlocked
```

### State Flow: Subscription Lifecycle

```
NEW ACCOUNT
    ↓ (create account)
Plan: Free, Limits: 1 repo / 1 service / 1 user
    ↓ (user clicks upgrade)
CHECKOUT INITIATED
    ↓ (Stripe Checkout session created)
    ↓ (user completes payment)
WEBHOOK: checkout.session.completed
    ↓
Plan: Paid, Limits: 5 repos / 10 services / 5 users
    ↓ (subscription active)
MONTHLY RENEWAL
    ↓ (Stripe charges automatically)
WEBHOOK: invoice.payment_succeeded (no state change, account stays Paid)
    ↓
    ↓ (user cancels subscription)
WEBHOOK: customer.subscription.deleted
    ↓
Plan: Free, Limits: 1 repo / 1 service / 1 user
    ↓
Existing resources stay (soft enforcement), new resources blocked
```

### Trial Flow: 14-Day Trial Auto-Downgrade

```
USER SIGNS UP
    ↓
Account created: plan=Free, trialEndsAt=null
    ↓ (user clicks "Start Trial")
START TRIAL
    ↓
Update account: plan=Trial, planLimits=PRO_LIMITS, trialEndsAt=now+14days
    ↓
User has 14 days with Pro features
    ↓
BACKGROUND JOB (runs hourly)
    ↓
Check: trialEndsAt < now && stripeSubscriptionId == null?
    ↓ YES (trial expired, not subscribed)
AUTO-DOWNGRADE
    ↓
Update account: plan=Free, planLimits=FREE_LIMITS, trialEndsAt=null
    ↓
Next user action: PlanEnforcement blocks creating 2nd repo
    ↓
UI shows: "Trial ended. Upgrade to Pro to add more repositories."
```

### Key Data Flows

1. **Upgrade Flow:** User action → Stripe Checkout → Webhook → Database update (async)
2. **Limit Enforcement:** User action → PlanEnforcementService query → Allow/Block decision
3. **Usage Display:** Page load → PlanEnforcementService.getUsage() → Render current/limit
4. **Payment Failure:** Stripe invoice fails → Webhook → Mark account as payment_failed → Send email alert

## Integration Points

### External Services

| Service                   | Integration Pattern                            | Notes                                                                  |
| ------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| **Stripe API**            | REST API via official SDK                      | Create checkout sessions, billing portal sessions, fetch subscriptions |
| **Stripe Webhooks**       | POST endpoint with HMAC signature verification | Source of truth for subscription state changes                         |
| **Stripe Billing Portal** | Redirect URL generated via SDK                 | Customer self-service (cancel, update payment method)                  |

### Internal Boundaries

| Boundary                            | Communication                                      | Notes                                   |
| ----------------------------------- | -------------------------------------------------- | --------------------------------------- |
| Routes ↔ Services                  | Direct function calls (DI)                         | Services injected into route handlers   |
| Services ↔ Repositories            | Direct function calls (DI)                         | Repositories injected into services     |
| PlanEnforcement ↔ Repositories     | Query 4 repos (account, repo, service, membership) | Counts resources to check limits        |
| WebhookHandler ↔ AccountRepository | Direct mutation (upgradeToPaid, downgradeToFree)   | Webhook is only writer for plan changes |
| StripeService ↔ Stripe SDK         | Adapter pattern (StripeClient interface)           | Allows mocking for tests                |

## Scaling Considerations

| Scale             | Architecture Adjustments                                                                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **0-1k users**    | Current architecture (monolith, synchronous webhooks). MongoDB + Fastify handle easily. No queue needed.                                                                                                                 |
| **1k-100k users** | Add webhook processing queue (BullMQ/Redis) to handle webhook spikes during subscription renewals. Cache plan limits in Redis to reduce DB queries on every request.                                                     |
| **100k+ users**   | Extract billing service as separate microservice with dedicated database. Use message queue (Kafka/RabbitMQ) for cross-service events. Implement read replicas for usage queries. Consider CDN for static billing pages. |

### Scaling Priorities

1. **First bottleneck:** Webhook processing during renewal spikes (thousands fire simultaneously at billing cycle). **Fix:** Async queue with worker pool, respond to Stripe immediately, process in background.

2. **Second bottleneck:** Plan enforcement queries (count repos/services/users on every creation). **Fix:** Cache current usage in Redis with TTL, invalidate on writes.

## Anti-Patterns

### Anti-Pattern 1: Trusting Client-Side Plan State

**What people do:** Store user's plan in JWT or session, check limits in client-side JavaScript.

**Why it's wrong:** User can modify JWT/session/JS, bypass limits, create unlimited resources. Security vulnerability.

**Do this instead:** Always enforce limits server-side in service layer via `PlanEnforcementService`. Client state is for UI only (show/hide upgrade CTA), never for authorization.

### Anti-Pattern 2: Synchronous Plan Upgrades (No Webhooks)

**What people do:** After Stripe Checkout, immediately upgrade user's plan in database before webhook arrives.

**Why it's wrong:** Payment can fail after redirect (3D Secure rejected, fraud check), user gets upgraded without paying. Webhook is source of truth.

**Do this instead:** Wait for `checkout.session.completed` webhook to confirm payment. Show "Processing..." state until webhook updates database.

### Anti-Pattern 3: Hard-Deleting Resources on Downgrade

**What people do:** When user downgrades to Free (1 repo limit), automatically delete repos 2-5.

**Why it's wrong:** Loses customer data, causes anger, may violate data protection laws. Extreme UX harm.

**Do this instead:** **Soft enforcement**: Block creating NEW resources beyond limit, but preserve existing ones. Show warning: "You have 5 repos but Free plan allows 1. Upgrade to manage all repos." Let user delete themselves.

### Anti-Pattern 4: Storing Plan Limits in Multiple Places

**What people do:** Plan limits in application config, database, and Stripe metadata. Three sources of truth.

**Why it's wrong:** Limits drift out of sync, different parts of app enforce different limits, billing bugs.

**Do this instead:** **Single source of truth**: Store limits in Account.planLimits (database). Application config defines plan templates, but database is runtime source.

### Anti-Pattern 5: Ignoring Webhook Signature Verification

**What people do:** Accept any POST to `/webhooks/stripe` without verifying Stripe-Signature header.

**Why it's wrong:** Attacker sends fake webhook upgrading their account to Paid without paying.

**Do this instead:** Always verify HMAC signature using Stripe SDK. Reject unsigned webhooks. Use webhook secret from Stripe dashboard.

## Build Order Dependencies

Suggested implementation order for adding billing to GitLaunch:

1. **Foundation (Phase 1):**

   - Extend Account model (plan, planLimits, stripeCustomerId, stripeSubscriptionId, trialEndsAt, paymentFailedAt)
   - Add PlanEnforcementService (check limits, no enforcement yet)
   - REASON: Establishes data model before building features

2. **Stripe Integration (Phase 2):**

   - StripeService (checkout, billing portal)
   - Settings/Billing page (upgrade CTA, usage display)
   - Billing portal redirect
   - REASON: User can initiate upgrade, but webhook processing not yet live

3. **Webhook Processing (Phase 3):**

   - WebhookHandler (checkout.session.completed, subscription.deleted)
   - Stripe webhook route with signature verification
   - Test with Stripe CLI
   - REASON: Completes upgrade flow (user can actually become Paid)

4. **Limit Enforcement (Phase 4):**

   - Integrate PlanEnforcementService into all resource creation paths
   - Add error handling for PlanLimitError (show upgrade CTA)
   - REASON: Requires working upgrade flow to be testable

5. **Trial Management (Phase 5):**

   - Trial start/end logic
   - Background job for auto-downgrade
   - Trial CTA on dashboard
   - REASON: Depends on enforcement and webhooks being stable

6. **Payment Failure Handling (Phase 6):**
   - Handle invoice.payment_failed webhook
   - Grace period logic
   - Email notifications
   - REASON: Edge case handling after core flows work

## Sources

**Official Documentation:**

- [Stripe Billing Subscriptions Overview](https://docs.stripe.com/billing/subscriptions/overview) - HIGH confidence
- [Stripe Subscription Webhooks](https://docs.stripe.com/billing/subscriptions/webhooks) - HIGH confidence

**Architecture Patterns:**

- [Architecture Patterns for SaaS Platforms](https://medium.com/appfoster/architecture-patterns-for-saas-platforms-billing-rbac-and-onboarding-964ea071f571) - MEDIUM confidence
- [Billing System Architecture for SaaS 101](https://www.withorb.com/blog/billing-architecture) - MEDIUM confidence
- [Building Rock-Solid Stripe Integrations](https://stripe.dev/blog/building-solid-stripe-integrations-developers-guide-success) - MEDIUM confidence

**Best Practices:**

- [Guide to Stripe Webhooks: Features and Best Practices](https://hookdeck.com/webhooks/platforms/guide-to-stripe-webhooks-features-and-best-practices) - MEDIUM confidence
- [Beyond Metering: Implementing Usage-Based Pricing](https://www.stigg.io/blog-posts/beyond-metering-the-only-guide-youll-ever-need-to-implement-usage-based-pricing) - LOW confidence (web search only)

---

_Architecture research for: GitLaunch subscription billing_
_Researched: 2026-02-08_
