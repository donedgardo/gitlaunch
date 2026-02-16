# Phase 4: Trial & Payment Lifecycle - Research

**Researched:** 2026-02-16
**Domain:** SaaS trial management, payment failure handling, MongoDB-based state tracking
**Confidence:** HIGH

## Summary

Phase 4 implements a 14-day no-credit-card trial system with trial abuse prevention, auto-downgrade on expiry, read-only enforcement for over-limit resources, and payment failure grace periods. The architecture leverages existing MongoDB infrastructure, Account schema extensions, and event-driven trial expiry checks (not background cron jobs). Trial tracking is local (not Stripe trial periods) since no credit card is collected upfront. GitHub user ID serves as the unique trial identifier to prevent repeat abuse.

**Primary recommendation:** Extend Account schema with trial fields (trialEndsAt, trialUsedByGithubId), add unique index on githubId in a TrialRegistry collection, implement event-driven trial expiry checks on dashboard load, extend PlanEnforcementService with read-only state computation, and enhance payment failure webhook handler with grace period logic (5-7 days industry standard).

## Standard Stack

### Core

| Library     | Version  | Purpose                                 | Why Standard                                                          |
| ----------- | -------- | --------------------------------------- | --------------------------------------------------------------------- |
| MongoDB     | ^6.5.0   | Trial state persistence, unique indexes | Already in use, native TTL indexes, atomic operations for idempotency |
| Stripe      | ^20.3.1  | Payment webhooks for failures           | Already integrated, handles subscription lifecycle events natively    |
| Native Date | Built-in | Trial countdown, expiry calculation     | No external library needed for simple date arithmetic (14 days)       |

### Supporting

| Library       | Version | Purpose                                | When to Use                                                      |
| ------------- | ------- | -------------------------------------- | ---------------------------------------------------------------- |
| Handlebars    | ^4.7.8  | UI trial countdown display             | Already in use for templates, custom helpers for date formatting |
| Fastify hooks | ^4.26.2 | Authorization middleware for read-only | Already in use, onRequest hooks for plan-aware authorization     |

### Alternatives Considered

| Instead of           | Could Use               | Tradeoff                                                                                           |
| -------------------- | ----------------------- | -------------------------------------------------------------------------------------------------- |
| Native Date          | date-fns                | date-fns adds 1.6KB for tree-shaking, overkill for simple 14-day calculations                      |
| Event-driven expiry  | node-cron               | Cron adds background polling overhead, event-driven checks on user action is more efficient        |
| MongoDB TTL          | Manual expiry           | TTL auto-cleanup is useful for audit trail, but trial state needs manual check for downgrade logic |
| MongoDB unique index | Application-level check | Race conditions possible with app-level checks, MongoDB unique index is atomic                     |

**Installation:**
No new packages required — all functionality uses existing dependencies.

## Architecture Patterns

### Recommended Project Structure

```
src/
├── repositories/
│   ├── accountRepository.ts        # Add trial fields, trialRegistry methods
│   ├── trialRegistryRepository.ts  # NEW: Track githubId -> trial usage
├── services/
│   ├── billing/
│   │   ├── trialService.ts         # NEW: Trial lifecycle logic
│   │   ├── planEnforcementService.ts  # Extend: isReadOnly state
│   │   ├── webhookHandler.ts       # Extend: grace period logic
├── server/routes/
│   ├── dashboard/                  # Extend: trial expiry check on load
│   ├── webhooks/stripe.ts          # Already handles payment_failed
└── templates/
    └── dashboard.hbs               # Add trial countdown UI
```

### Pattern 1: Trial State in Account Schema

**What:** Store trial data directly in Account document, not separate collection
**When to use:** Trial is account-level state, not user-level or subscription-level
**Example:**

```typescript
// Extend Account type in accountRepository.ts
export type Account = {
  // ... existing fields
  trialEndsAt: Date | null; // When trial expires (null if not on trial)
  trialUsedByGithubId: number | null; // Which GitHub user claimed trial (null if never used)
  paymentFailedAt: Date | null; // Already exists from Phase 1
  // ... other fields
};
```

### Pattern 2: Unique Trial Registry with MongoDB Index

**What:** Separate collection with unique index on githubId to prevent duplicate trials
**When to use:** Atomic enforcement of "one trial per GitHub user" rule
**Example:**

```typescript
// New: src/repositories/trialRegistryRepository.ts
export type TrialRegistryEntry = {
  _id: ObjectId;
  githubId: number; // Unique index enforces one trial per user
  accountId: ObjectId; // Which account used the trial
  claimedAt: Date; // When trial was claimed
};

// In ensureIndexes():
await collection.createIndex({ githubId: 1 }, { unique: true });
```

### Pattern 3: Event-Driven Trial Expiry Check

**What:** Check trial expiry on user action (dashboard load), not background cron
**When to use:** Trial expiry is not time-critical (minutes don't matter), user-triggered is sufficient
**Example:**

```typescript
// In dashboard route handler
async function handleDashboardLoad(request, reply) {
  const account = await accountRepo.findById(accountId);

  // Check if trial expired
  if (account.trialEndsAt && new Date() > account.trialEndsAt) {
    await trialService.handleTrialExpiry(account._id);
    // Reload account with new state (downgraded to Free)
    account = await accountRepo.findById(accountId);
  }

  // Continue with dashboard rendering
}
```

### Pattern 4: Grace Period for Payment Failures

**What:** Track paymentFailedAt, compute grace period on dashboard/API requests
**When to use:** Give users 5-7 days to fix payment before restriction
**Example:**

```typescript
// In PlanEnforcementService
isInGracePeriod(account: Account): boolean {
  if (!account.paymentFailedAt) return false;
  const gracePeriodDays = 7; // Industry standard: 3-7 days
  const gracePeriodEnd = new Date(account.paymentFailedAt);
  gracePeriodEnd.setDate(gracePeriodEnd.getDate() + gracePeriodDays);
  return new Date() < gracePeriodEnd;
}

// Usage in enforcement
if (isOverLimit && !isInGracePeriod(account)) {
  throw new ForbiddenError("Plan limit exceeded");
}
```

### Pattern 5: Read-Only State Computation

**What:** Compute isReadOnly based on plan limits + current usage, don't store as field
**When to use:** Derived state that changes as usage changes
**Example:**

```typescript
// In PlanEnforcementService
async getAccountState(accountId: ObjectId): Promise<AccountState> {
  const usage = await this.getUsage(accountId);
  const account = await this.accountRepo.findById(accountId);

  // Read-only if over-limit after downgrade (e.g., had 10 repos on Pro, downgraded to Free limit of 3)
  const isOverRepoLimit = usage.repositories.current > usage.repositories.limit;
  const isOverServiceLimit = usage.services.current > usage.services.limit;

  return {
    plan: account.plan,
    isReadOnly: isOverRepoLimit || isOverServiceLimit,
    usage,
  };
}
```

### Anti-Patterns to Avoid

- **Background cron for trial expiry:** Adds complexity, overhead. Event-driven on user action is sufficient (trial expiry is not time-critical).
- **Storing isReadOnly in database:** Derived state that goes stale. Compute on-demand from plan limits + usage.
- **Application-level trial duplicate check:** Race conditions. Use MongoDB unique index for atomicity.
- **Immediate restriction on payment failure:** Industry standard is grace period (5-7 days). Immediate restriction harms UX.
- **Using Stripe trial periods:** Requires credit card upfront. Local MongoDB trial allows no-CC trials.

## Don't Hand-Roll

| Problem                    | Don't Build                        | Use Instead                                          | Why                                                                                 |
| -------------------------- | ---------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Date arithmetic            | Custom date utilities              | Native Date methods                                  | 14-day calculation is trivial: `new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)` |
| Trial duplicate prevention | Application-level uniqueness check | MongoDB unique index on githubId                     | Atomic, prevents race conditions, handles error code 11000 gracefully               |
| Webhook idempotency        | Custom deduplication logic         | Already implemented WebhookEventRepository (Phase 1) | MongoDB unique index on stripeEventId, TTL cleanup                                  |
| Payment retry logic        | Custom retry scheduler             | Stripe Smart Retries                                 | Stripe handles retry schedule, sends webhooks on each attempt                       |
| Grace period state machine | Complex state transitions          | Simple timestamp comparison                          | `paymentFailedAt + gracePeriodDays > now` is sufficient                             |

**Key insight:** Trial management is domain logic (business rules about who gets trials, when they expire), not infrastructure. Use existing MongoDB primitives (unique indexes, Date fields, atomic updates) rather than external job schedulers or state machines.

## Common Pitfalls

### Pitfall 1: Race Conditions in Trial Claiming

**What goes wrong:** Multiple accounts created simultaneously by same GitHub user, each claims trial
**Why it happens:** Application checks if trial used, then creates account — not atomic
**How to avoid:** Use MongoDB unique index on githubId in TrialRegistry, handle duplicate key error (code 11000) gracefully
**Warning signs:** Integration tests with concurrent account creation fail sporadically

### Pitfall 2: Trial Expiry Notification Fatigue

**What goes wrong:** User sees "Trial expired" message on every page load after expiry
**Why it happens:** Expiry check runs on every request, downgrade logic is idempotent but message isn't
**How to avoid:** Only show message if account.plan changed in current request (compare before/after state)
**Warning signs:** User complaints about repetitive notifications

### Pitfall 3: Forgetting to Clear Trial State on Subscription

**What goes wrong:** User subscribes to Pro, but trialEndsAt still set, causing confusion
**Why it happens:** upgradeToPlan doesn't clear trial fields
**How to avoid:** In AccountRepository.upgradeToPlan, set `trialEndsAt: null` when setting stripeSubscriptionId
**Warning signs:** Subscribed users still see trial countdown in UI

### Pitfall 4: Grace Period Without User Notification

**What goes wrong:** User's payment fails, no notification sent, suddenly restricted after 7 days
**Why it happens:** Grace period logic exists but no email/UI alert
**How to avoid:** Add UI warning on dashboard when in grace period, show days remaining
**Warning signs:** User complaints about surprise restrictions

### Pitfall 5: Read-Only Enforcement Inconsistency

**What goes wrong:** Some routes enforce read-only, others don't (user can modify via API but not UI)
**Why it happens:** Read-only check not in centralized middleware, scattered across route handlers
**How to avoid:** Fastify onRequest hook that checks account state, sets request.isReadOnly for all routes to use
**Warning signs:** Users report "I can't do X in UI but can via API"

### Pitfall 6: Over-Limit Resources Not Visible

**What goes wrong:** User downgrades from Pro (10 repos) to Free (3 repos), can't see their 7 other repos
**Why it happens:** Queries filter by plan limit instead of showing all with read-only flag
**How to avoid:** Always return all resources, mark over-limit ones as read-only (e.g., repos 4-10 shown but grayed out)
**Warning signs:** User panic: "My repositories disappeared!"

## Code Examples

Verified patterns from MongoDB documentation and Stripe best practices:

### Trial Claiming with Atomic Duplicate Prevention

```typescript
// Source: MongoDB Unique Indexes - https://www.mongodb.com/docs/manual/core/index-unique/
async claimTrial(accountId: ObjectId, githubId: number): Promise<boolean> {
  try {
    await this.trialRegistryCollection.insertOne({
      githubId,
      accountId,
      claimedAt: new Date(),
    });

    // Success — trial claimed, update account
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    await this.accountRepo.collection.updateOne(
      { _id: accountId },
      {
        $set: {
          trialEndsAt,
          trialUsedByGithubId: githubId,
        }
      }
    );

    return true;
  } catch (error: any) {
    // MongoDB duplicate key error code
    if (error.code === 11000) {
      return false; // Trial already used by this GitHub user
    }
    throw error;
  }
}
```

### Trial Expiry Check and Auto-Downgrade

```typescript
// Pattern: Event-driven expiry on user action
async checkAndHandleTrialExpiry(accountId: ObjectId): Promise<boolean> {
  const account = await this.accountRepo.findById(accountId);

  // Not on trial or trial still active
  if (!account.trialEndsAt || new Date() < account.trialEndsAt) {
    return false;
  }

  // Trial expired — downgrade to Free
  await this.accountRepo.downgradeToFree(account._id);
  return true; // Signal that downgrade happened
}
```

### Grace Period Computation

```typescript
// Source: Stripe webhook best practices - https://docs.stripe.com/billing/subscriptions/webhooks
const GRACE_PERIOD_DAYS = 7; // Industry standard: 3-7 days

function isInGracePeriod(account: Account): boolean {
  if (!account.paymentFailedAt) return false;

  const gracePeriodEnd = new Date(account.paymentFailedAt);
  gracePeriodEnd.setDate(gracePeriodEnd.getDate() + GRACE_PERIOD_DAYS);

  return new Date() < gracePeriodEnd;
}

function getGracePeriodDaysRemaining(account: Account): number {
  if (!account.paymentFailedAt) return 0;

  const gracePeriodEnd = new Date(account.paymentFailedAt);
  gracePeriodEnd.setDate(gracePeriodEnd.getDate() + GRACE_PERIOD_DAYS);

  const msRemaining = gracePeriodEnd.getTime() - Date.now();
  return Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
}
```

### Trial Countdown Handlebars Helper

```typescript
// Custom helper for trial days remaining
Handlebars.registerHelper(
  "trialDaysRemaining",
  function (trialEndsAt: Date | null) {
    if (!trialEndsAt) return 0;

    const msRemaining = new Date(trialEndsAt).getTime() - Date.now();
    const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));

    return Math.max(0, daysRemaining); // Don't show negative days
  },
);
```

### Read-Only Enforcement Middleware

```typescript
// Fastify onRequest hook for plan-aware authorization
async function planEnforcementHook(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const accountId = request.user.accountId; // From auth
  const accountState = await planEnforcementService.getAccountState(accountId);

  // Attach state to request for route handlers
  request.accountState = accountState;

  // Check if this is a write operation and account is read-only
  const isWriteOperation = ["POST", "PUT", "PATCH", "DELETE"].includes(
    request.method,
  );
  if (isWriteOperation && accountState.isReadOnly) {
    return reply.status(403).send({
      error:
        "Account is in read-only mode due to plan limits. Upgrade to modify resources.",
    });
  }
}

// Register hook for protected routes
app.register(async function (fastify) {
  fastify.addHook("onRequest", planEnforcementHook);

  // All routes here are subject to plan enforcement
  fastify.post("/api/repositories", createRepositoryHandler);
  fastify.delete("/api/repositories/:id", deleteRepositoryHandler);
});
```

## State of the Art

| Old Approach                             | Current Approach                   | When Changed             | Impact                                                           |
| ---------------------------------------- | ---------------------------------- | ------------------------ | ---------------------------------------------------------------- |
| Stripe trial periods                     | MongoDB-based trials               | 2024+                    | Allows no-CC trials, more control over trial logic               |
| Background cron for expiry               | Event-driven on user action        | 2024+                    | Reduces infrastructure complexity, no polling overhead           |
| Immediate restriction on payment failure | Grace period (3-7 days)            | Industry standard 2020+  | Better UX, gives users time to fix payment issues                |
| Hard delete over-limit resources         | Read-only state (soft restriction) | SaaS best practice 2020+ | Users keep visibility, creates upgrade urgency without data loss |
| Application-level duplicate prevention   | MongoDB unique indexes             | Always recommended       | Atomic operations prevent race conditions                        |

**Deprecated/outdated:**

- **Moment.js for date formatting:** Deprecated, use native Intl.DateTimeFormat or date-fns (though native Date arithmetic is sufficient for this phase)
- **Express middleware style in Fastify:** Use Fastify hooks (onRequest, preHandler) instead of @fastify/express

## Open Questions

1. **Trial expiry notification timing**

   - What we know: Trial expires after 14 days, auto-downgrade on next login
   - What's unclear: Should we send email notification before expiry (e.g., 3 days, 1 day warnings)?
   - Recommendation: Phase 4 focuses on core trial mechanics. Email notifications can be Phase 5 (not blocking).

2. **Grace period duration**

   - What we know: Industry standard is 3-7 days
   - What's unclear: User preference for this app (generous 7 days vs. standard 5 days)
   - Recommendation: Start with 7 days (more generous), can adjust based on feedback. Make it a constant for easy tuning.

3. **Trial re-activation after abuse attempt**

   - What we know: One trial per GitHub user ID enforced via unique index
   - What's unclear: What if user contacts support claiming they never actually used trial (e.g., just created account)?
   - Recommendation: Manual override via admin tool out of scope for Phase 4. Unique index prevents automated abuse, manual edge cases handled later.

4. **Read-only UI patterns**
   - What we know: Over-limit resources should be visible but not modifiable
   - What's unclear: Exact UI pattern (grayed out buttons, modal explaining upgrade, inline messages)
   - Recommendation: Start with simple approach (disable buttons, show tooltip "Upgrade to modify"). Can enhance UX in later iterations.

## Sources

### Primary (HIGH confidence)

- [MongoDB Unique Indexes Documentation](https://www.mongodb.com/docs/manual/core/index-unique/) - Unique index creation, duplicate key error handling
- [MongoDB TTL Indexes Documentation](https://www.mongodb.com/docs/manual/core/index-ttl/) - Automatic document expiration patterns
- [Stripe Subscriptions Webhooks Documentation](https://docs.stripe.com/billing/subscriptions/webhooks) - Payment failure webhook handling
- [Stripe Smart Retries Documentation](https://docs.stripe.com/billing/revenue-recovery/smart-retries) - Payment retry schedule
- Existing codebase patterns:
  - `src/repositories/accountRepository.ts` - Account schema, Plan enum, PLAN_LIMITS_MAP
  - `src/repositories/webhookEventRepository.ts` - Webhook idempotency with unique index
  - `src/services/billing/webhookHandler.ts` - Payment failure handling (setPaymentFailed, clearPaymentFailed)
  - `src/services/billing/planEnforcementService.ts` - Plan limit enforcement, getUsage pattern

### Secondary (MEDIUM confidence)

- [SaaS Trial Strategy Best Practices](https://payproglobal.com/how-to/build-saas-trial-strategy/) - Trial length, fraud prevention patterns
- [SaaS Free Trial Best Practices (F22Labs)](https://www.f22labs.com/blogs/saas-free-trial-best-practices-pitfalls/) - User engagement, trial conversion strategies
- [Grace Periods in SaaS Billing (SignEasy)](https://signeasy.com/blog/engineering/grace-periods) - Grace period implementation details
- [Payment Grace Period in Subscription Billing (SubscriptionFlow)](https://www.subscriptionflow.com/2025/06/payment-grace-period/) - Industry standards for grace period duration
- [date-fns vs Day.js Comparison (DhiWise)](https://www.dhiwise.com/post/date-fns-vs-dayjs-the-battle-of-javascript-date-libraries) - Date library comparison (decided against external library)
- [Node-cron Scheduled Tasks (Better Stack)](https://betterstack.com/community/guides/scaling-nodejs/node-cron-scheduled-tasks/) - Cron job patterns (decided against background jobs)
- [MongoDB Change Streams (MongoDB Docs)](https://www.mongodb.com/docs/manual/changestreams/) - Event-driven alternative to polling (overkill for this use case)

### Tertiary (LOW confidence)

- WebSearch findings on trial abuse prevention (general patterns, not specific to MongoDB/TypeScript)
- WebSearch findings on read-only enforcement (no unified TypeScript pattern found, using custom approach)

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - All libraries already in use, no new dependencies needed
- Architecture: HIGH - Patterns verified against MongoDB docs, Stripe docs, existing codebase structure
- Pitfalls: MEDIUM-HIGH - Based on SaaS best practices articles and common MongoDB gotchas

**Research date:** 2026-02-16
**Valid until:** 2026-03-16 (30 days - stable domain, MongoDB/Stripe patterns well-established)
