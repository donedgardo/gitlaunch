# Phase 1: Billing Foundation - Research

**Researched:** 2026-02-09
**Domain:** Stripe webhook integration, subscription management, MongoDB idempotency
**Confidence:** HIGH

## Summary

Phase 1 establishes Stripe webhook infrastructure for subscription lifecycle management. The codebase already has foundational Stripe integration (StripeService, StripeWebhookHandler, webhook route with signature verification), but lacks: (1) a MembershipService abstraction layer, (2) idempotent webhook processing via MongoDB event tracking, and (3) production-ready webhook signature verification.

Stripe webhooks use signature verification via the `stripe.webhooks.constructEvent()` method, requiring raw request body access (not parsed JSON). Fastify requires the `fastify-raw-body` plugin to preserve raw bodies for signature verification. Webhooks are retried for up to 3 days, making idempotency mandatory. The standard pattern is to track processed event IDs in MongoDB with unique constraints to prevent duplicate processing.

**Primary recommendation:** Build MembershipService interface with StripeService as first implementation, add MongoDB webhook event collection with unique constraint on Stripe event ID, configure fastify-raw-body plugin for signature verification.

## Standard Stack

### Core

| Library          | Version          | Purpose               | Why Standard                                                             |
| ---------------- | ---------------- | --------------------- | ------------------------------------------------------------------------ |
| stripe           | Latest (20.3.0+) | Stripe Node.js SDK    | Official SDK with `webhooks.constructEvent()` for signature verification |
| fastify-raw-body | Latest           | Raw body preservation | Required for Stripe webhook signature verification in Fastify            |
| mongodb          | 6.5.0 (existing) | Database              | Already in use, supports unique constraints for idempotency              |
| vitest           | 1.3.1 (existing) | Testing               | Project standard for TDD workflow                                        |

### Supporting

| Library               | Version           | Purpose                     | When to Use                                   |
| --------------------- | ----------------- | --------------------------- | --------------------------------------------- |
| mongodb-memory-server | 11.0.1 (existing) | In-memory MongoDB for tests | All unit/integration tests requiring database |

### Alternatives Considered

| Instead of           | Could Use                  | Tradeoff                                                             |
| -------------------- | -------------------------- | -------------------------------------------------------------------- |
| fastify-raw-body     | Custom content parser      | More control but unnecessary complexity; plugin is standard solution |
| MongoDB unique index | Application-level tracking | Loses atomicity guarantees; race conditions possible                 |

**Installation:**

```bash
yarn add stripe fastify-raw-body
```

## Architecture Patterns

### Recommended Project Structure

```
src/
├── services/
│   ├── billing/
│   │   ├── membershipService.ts          # Interface (new)
│   │   ├── stripeService.ts              # Implements MembershipService (modify)
│   │   ├── webhookHandler.ts             # Existing - handles events
│   │   └── stripeSignatureVerifier.ts    # Existing - wraps Stripe SDK
├── repositories/
│   └── webhookEventRepository.ts         # New - tracks processed events
├── server/
│   └── routes/
│       └── webhooks/
│           └── stripe.ts                 # Existing - needs raw body plugin
```

### Pattern 1: MembershipService Interface (Dependency Inversion)

**What:** Provider-agnostic abstraction for subscription operations
**When to use:** When supporting multiple payment providers or isolating payment logic from business logic
**Example:**

```typescript
// Based on DIP pattern: high-level code depends on abstractions
// Source: https://dev.to/hassanzohdy/dependency-inversion-principle-dip-in-typescript-3n5h

export interface MembershipService {
  createCheckoutSession(params: {
    accountId: string;
    userEmail: string | null;
  }): Promise<{ url: string; sessionId: string }>;

  createBillingPortalSession(params: {
    accountId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;

  getSubscriptionStatus(accountId: string): Promise<{
    status: string;
    currentPeriodEnd: Date;
  } | null>;
}

export class StripeService implements MembershipService {
  // Existing StripeService becomes first implementation
  // Constructor takes StripeClient (already exists)
}
```

### Pattern 2: Webhook Idempotency via MongoDB Unique Constraint

**What:** Track processed webhook event IDs in MongoDB collection with unique index
**When to use:** Always - Stripe retries webhooks for up to 3 days
**Example:**

```typescript
// Source: https://event-driven.io/en/dealing_with_eventual_consistency_and_idempotency_in_mongodb_projections/
// Source: https://hookdeck.com/webhooks/guides/implement-webhook-idempotency

export type WebhookEvent = {
  _id: ObjectId;
  stripeEventId: string; // Unique index here
  eventType: string;
  processedAt: Date;
  payload: Record<string, any>;
};

export class WebhookEventRepository {
  async markAsProcessed(
    stripeEventId: string,
    eventType: string,
    payload: any,
  ): Promise<boolean> {
    try {
      await this.collection.insertOne({
        stripeEventId,
        eventType,
        processedAt: new Date(),
        payload,
      });
      return true; // First time processing
    } catch (error) {
      if (error.code === 11000) {
        // Duplicate key error
        return false; // Already processed
      }
      throw error;
    }
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ stripeEventId: 1 }, { unique: true });
  }
}
```

### Pattern 3: Fastify Raw Body for Signature Verification

**What:** Use fastify-raw-body plugin to preserve raw request body for HMAC verification
**When to use:** Any Stripe webhook endpoint
**Example:**

```typescript
// Source: https://docs.stripe.com/webhooks/quickstart?lang=node
// Source: https://github.com/fastify/help/issues/158

import rawBody from "fastify-raw-body";

// In server setup:
await app.register(rawBody, {
  field: "rawBody",
  global: false, // Only on specific routes
  encoding: "utf8",
  runFirst: true,
});

// In webhook route:
app.post("/webhooks/stripe", async (request, reply) => {
  const signature = request.headers["stripe-signature"];
  const event = stripe.webhooks.constructEvent(
    request.rawBody, // From plugin - NOT request.body
    signature,
    webhookSecret,
  );
  // ... process event
});
```

### Pattern 4: Webhook Event Handler Pattern (Existing)

**What:** Separate signature verification (route) from business logic (handler)
**When to use:** Already implemented correctly in codebase
**Example:**

```typescript
// Current pattern (already in codebase):
// 1. Route layer: Signature verification, event parsing
// 2. Handler layer: Business logic, database updates
// 3. Repository layer: Data persistence

// This separation allows:
// - Testing business logic without webhook infrastructure
// - Swapping signature verification strategies
// - Reusing handler for non-webhook scenarios (e.g., admin tools)
```

### Anti-Patterns to Avoid

- **Parsing body before verification:** Stripe signature requires raw body; any JSON parsing breaks HMAC verification
- **Processing without idempotency check:** Webhooks are retried; duplicate processing corrupts data
- **Assuming event order:** Events arrive out-of-order; use API calls to fetch current state
- **Synchronous webhook processing:** Return 200 immediately; queue/async for slow operations
- **Forgetting to return 200:** Stripe retries if non-2xx status returned

## Don't Hand-Roll

| Problem                            | Don't Build                                      | Use Instead                         | Why                                                                     |
| ---------------------------------- | ------------------------------------------------ | ----------------------------------- | ----------------------------------------------------------------------- |
| Webhook signature verification     | Custom HMAC validation                           | `stripe.webhooks.constructEvent()`  | Handles timestamp tolerance, signature extraction, crypto edge cases    |
| Raw body access in Fastify         | Custom content parser                            | `fastify-raw-body` plugin           | Tested with Stripe, handles encoding, integrates with Fastify lifecycle |
| Idempotency tracking               | In-memory Set or application-level deduplication | MongoDB unique index on event ID    | Atomic, survives restarts, handles concurrent requests                  |
| Webhook retry logic                | Custom retry scheduler                           | Stripe's automatic retries (3 days) | Industry-tested retry backoff, configurable in dashboard                |
| Subscription state synchronization | Polling Stripe API                               | Webhooks as source of truth         | Real-time updates, reduces API calls, Stripe best practice              |

**Key insight:** Webhook infrastructure has deceptively complex edge cases (replay attacks, race conditions, clock skew, encoding issues). Use battle-tested libraries and patterns, not custom implementations.

## Common Pitfalls

### Pitfall 1: Wrong Endpoint Secret

**What goes wrong:** Signature verification always fails with "Invalid signature" error
**Why it happens:** Stripe uses different secrets for test/live mode, and for different webhook endpoints
**How to avoid:** Use endpoint-specific secret from Stripe dashboard (starts with `whsec_`), not API secret key
**Warning signs:** All webhook requests return 400; logs show "Webhook signature verification failed"

### Pitfall 2: Body Parsing Before Verification

**What goes wrong:** Signature verification fails because body was modified by JSON parser
**Why it happens:** Fastify (and Express) automatically parse JSON bodies before route handlers
**How to avoid:** Use `fastify-raw-body` plugin with `runFirst: true`; access `request.rawBody` not `request.body`
**Warning signs:** Signature verification works in tests but fails in production; "Invalid signature" errors

### Pitfall 3: Missing Idempotency Checks

**What goes wrong:** Account upgraded twice, subscription state corrupted, duplicate charges
**Why it happens:** Stripe retries webhooks on timeout/5xx/network errors
**How to avoid:** Check `WebhookEventRepository.markAsProcessed()` before processing; return 200 for duplicates
**Warning signs:** Duplicate database entries for same event; accounts with impossible state transitions

### Pitfall 4: Clock Skew Rejecting Valid Webhooks

**What goes wrong:** Valid webhooks rejected with timestamp-related errors
**Why it happens:** Stripe includes timestamp in signature; servers with incorrect clocks fail validation
**How to avoid:** Use NTP to sync server clock; Stripe allows 5-minute tolerance by default
**Warning signs:** Intermittent signature failures; errors mention "timestamp too old"

### Pitfall 5: Webhook Handler Timeouts

**What goes wrong:** Webhook processing times out, Stripe retries, duplicate processing occurs
**Why it happens:** Handler performs slow operations (external API calls, complex calculations)
**How to avoid:** Return 200 immediately after marking event as processed; use async queue for slow work
**Warning signs:** 504/timeout errors in Stripe webhook logs; duplicate event processing despite idempotency

### Pitfall 6: Not Handling Event Order

**What goes wrong:** Processing events in wrong order causes state corruption
**Why it happens:** Network latency means events arrive out-of-order (subscription.updated before subscription.created)
**How to avoid:** Don't assume order; fetch current state from Stripe API or MongoDB when needed
**Warning signs:** "Account not found" errors in webhook handler; subscription states skipping stages

## Code Examples

Verified patterns from official sources:

### Stripe Webhook Signature Verification (Node.js + Fastify)

```typescript
// Source: https://docs.stripe.com/webhooks/quickstart?lang=node
// Adapted for Fastify (Express pattern in docs)

import Stripe from "stripe";
import rawBody from "fastify-raw-body";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET!;

// Register plugin
await app.register(rawBody, {
  field: "rawBody",
  global: false,
  encoding: "utf8",
  runFirst: true,
});

app.post("/webhooks/stripe", async (request, reply) => {
  const signature = request.headers["stripe-signature"] as string;

  if (!signature) {
    return reply.status(400).send({ error: "Missing Stripe signature" });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      request.rawBody, // CRITICAL: Use rawBody, not body
      signature,
      endpointSecret,
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return reply.status(400).send({ error: "Invalid signature" });
  }

  // Process event...
  return { received: true };
});
```

### Idempotent Webhook Processing

```typescript
// Source: https://medium.com/@sohail_saifii/handling-payment-webhooks-reliably-idempotency-retries-validation-69b762720bf5
// Source: https://hookdeck.com/webhooks/guides/implement-webhook-idempotency

async function processWebhook(event: Stripe.Event): Promise<void> {
  // 1. Check if already processed
  const alreadyProcessed = await webhookEventRepo.markAsProcessed(
    event.id,
    event.type,
    event.data.object,
  );

  if (!alreadyProcessed) {
    console.log(`Duplicate webhook ${event.id}, skipping`);
    return; // Return 200 to acknowledge
  }

  // 2. Process event (only if first time)
  switch (event.type) {
    case "checkout.session.completed":
      await webhookHandler.handleCheckoutCompleted(/* ... */);
      break;
    // ... other events
  }
}
```

### Fastify Content Type Parser (Alternative to fastify-raw-body)

```typescript
// Source: https://github.com/fastify/help/issues/158
// Alternative approach using built-in parser (fastify-raw-body recommended)

app.addContentTypeParser(
  "application/json",
  { parseAs: "buffer" },
  (req, body, done) => {
    try {
      const jsonString = body.toString("utf8");
      done(null, {
        raw: jsonString,
        parsed: JSON.parse(jsonString),
      });
    } catch (err) {
      done(err, undefined);
    }
  },
);
```

## State of the Art

| Old Approach                   | Current Approach                         | When Changed                       | Impact                                                  |
| ------------------------------ | ---------------------------------------- | ---------------------------------- | ------------------------------------------------------- |
| Manual HMAC validation         | `stripe.webhooks.constructEvent()`       | Stripe SDK v3+ (2016)              | Handles edge cases (clock skew, encoding) automatically |
| Webhook-only subscriptions     | Webhooks + API polling fallback          | 2020s best practice                | Handles missed webhooks gracefully                      |
| Application-level idempotency  | Database unique constraints              | Event-driven architecture maturity | Atomicity guarantees, race condition prevention         |
| Synchronous webhook processing | Return 200 immediately, async processing | Cloud/serverless era               | Prevents timeouts, supports retries                     |

**Deprecated/outdated:**

- **Stripe Checkout v1:** Replaced by v3 (Payment Intents API) in 2019; use `checkout.session.completed` not `charge.succeeded`
- **Stripe.js v2:** Replaced by v3 in 2016; modern SDK required for SCA compliance
- **Trial periods in Stripe:** Project decision is to track trials locally in MongoDB, not use Stripe's trial feature

## Open Questions

1. **MembershipService Interface Scope**

   - What we know: StripeService exists with checkout, portal, subscription status methods
   - What's unclear: Should interface include trial management? Should it own subscription CRUD or just payment flows?
   - Recommendation: Start minimal (checkout, portal, status); add trial methods in Phase 2 when trial logic is implemented

2. **Webhook Event Retention Policy**

   - What we know: Events must be tracked for idempotency
   - What's unclear: How long to retain processed events? (Storage grows indefinitely)
   - Recommendation: Add TTL index on `processedAt` field (30-90 days); Stripe retries stop after 3 days, so longer retention is for audit/debugging

3. **Raw Body Plugin Configuration**

   - What we know: fastify-raw-body required for signature verification
   - What's unclear: Should it be global (all routes) or route-specific? Encoding considerations?
   - Recommendation: Route-specific (`global: false`) with `encoding: 'utf8'`, `runFirst: true` per documentation

4. **Error Handling Strategy**
   - What we know: Return 200 for duplicate events; return 400 for invalid signatures
   - What's unclear: What about transient database errors? (Stripe retries on 5xx)
   - Recommendation: Distinguish permanent vs transient failures; 400 for invalid data, 500 for DB errors (allows retries)

## Sources

### Primary (HIGH confidence)

- [Stripe Official Docs: Webhooks](https://docs.stripe.com/webhooks) - Webhook best practices, event handling patterns
- [Stripe Official Docs: Signature Verification](https://docs.stripe.com/webhooks/signature) - Signature verification errors, troubleshooting
- [Stripe Official Docs: Node.js Quickstart](https://docs.stripe.com/webhooks/quickstart?lang=node) - Code examples, SDK version 20.3.0
- Event-Driven.io: [MongoDB Idempotency Patterns](https://event-driven.io/en/dealing_with_eventual_consistency_and_idempotency_in_mongodb_projections/) - MongoDB-specific idempotency implementation
- Hookdeck: [Implement Webhook Idempotency](https://hookdeck.com/webhooks/guides/implement-webhook-idempotency) - General webhook idempotency patterns

### Secondary (MEDIUM confidence)

- [DEV.to: Dependency Inversion Principle in TypeScript](https://dev.to/hassanzohdy/dependency-inversion-principle-dip-in-typescript-3n5h) - DIP patterns for payment provider abstraction
- [LogRocket: Dependency Inversion Principle](https://blog.logrocket.com/dependency-inversion-principle-typescript/) - TypeScript interface design patterns
- [GitHub: fastify/help #158](https://github.com/fastify/help/issues/158) - Fastify raw body strategies for Stripe
- [Medium: Handling Payment Webhooks Reliably](https://medium.com/@sohail_saifii/handling-payment-webhooks-reliably-idempotency-retries-validation-69b762720bf5) - Idempotency, retries, validation patterns
- [API7.ai: Payment Gateway APIs](https://api7.ai/learning-center/api-101/stripe-vs-paypal-api-integration-guide) - Multi-provider abstraction layer patterns

### Tertiary (LOW confidence - verify during implementation)

- NPM: [fastify-raw-body](https://www.npmjs.com/package/fastify-raw-body) - Plugin documentation (verify version compatibility)
- Stripe Blog: [Payments API Design](https://stripe.com/blog/payment-api-design) - Historical context on API evolution

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - Stripe SDK and fastify-raw-body are documented, official solutions
- Architecture: HIGH - Existing codebase already uses correct separation patterns; idempotency pattern is MongoDB standard
- Pitfalls: HIGH - Verified from official Stripe docs, GitHub issues, and production experience reports

**Research date:** 2026-02-09
**Valid until:** 2026-03-09 (30 days - stable domain, mature libraries)
