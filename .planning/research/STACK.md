# Technology Stack

**Project:** GitLaunch Subscription Billing
**Researched:** 2026-02-08
**Confidence:** HIGH

## Recommended Stack

### Core Subscription Integration

| Technology     | Version | Purpose                     | Why Recommended                                                                                                                                                                                                                              |
| -------------- | ------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| stripe         | ^20.3.1 | Official Stripe Node.js SDK | Official library with built-in TypeScript types, automatic retries with exponential backoff, idempotency keys. Supports Node 12+ (Node 16 deprecated, will be removed in next major). Most current and actively maintained.                  |
| fastify-stripe | ^2.0.0  | Fastify plugin for Stripe   | Encapsulates Stripe instance in Fastify framework, handles decorator pattern for `fastify.stripe`, supports all Stripe SDK config options (apiKey, maxNetworkRetries, timeout, apiVersion). Maintains consistency with Fastify's DI pattern. |

### Webhook Handling

| Technology        | Version | Purpose                                            | Why Recommended                                                                                                                                                                |
| ----------------- | ------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| @fastify/raw-body | ^5.0.0  | Raw body parser for webhook signature verification | Required for Stripe webhook signature verification. `stripe.webhooks.constructEvent()` needs raw request body (not parsed JSON). Fastify doesn't preserve raw body by default. |

### Development & Testing Tools

| Tool               | Purpose                         | Notes                                                                                                                                                                                      |
| ------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stripe CLI         | Local webhook testing           | Forward webhooks to localhost with `stripe listen --forward-to`. Provides test webhook signing secret. Trigger test events with `stripe trigger <event>`. Essential for local development. |
| Stripe Test Clocks | Time-based subscription testing | Simulate subscriptions through time without waiting. Test trials, renewals, payment failures, prorations. Available in Dashboard (no code needed).                                         |
| Stripe Test Cards  | Payment scenario simulation     | Test various payment outcomes (success, decline, authentication required) without real transactions. Test mode data auto-deleted after 90 days.                                            |

### Supporting Libraries (Optional)

| Library            | Version | Purpose                                      | When to Use                                                                                                                                         |
| ------------------ | ------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| stripe-event-types | ^3.1.0  | Enhanced TypeScript types for webhook events | If you need stronger webhook event typing beyond the official SDK. Community-maintained. MEDIUM confidence - verify compatibility with stripe@20.x. |

## Installation

```bash
# Core Stripe integration
yarn add stripe@^20.3.1 fastify-stripe@^2.0.0

# Webhook handling
yarn add @fastify/raw-body@^5.0.0

# Dev tools
# Install Stripe CLI: https://docs.stripe.com/stripe-cli
# macOS: brew install stripe/stripe-cli/stripe
# Linux: Download from GitHub releases
```

## Alternatives Considered

| Category            | Recommended              | Alternative          | Why Not                                                                                                                                                                          |
| ------------------- | ------------------------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe SDK wrapper  | Direct stripe package    | @stripe/stripe-js    | Client-side library for browser. We need server-side Node.js SDK.                                                                                                                |
| Fastify integration | fastify-stripe plugin    | Manual instantiation | Plugin provides proper encapsulation, decorator pattern, and config management. Follows Fastify best practices.                                                                  |
| Payment UI          | Stripe Checkout Sessions | Payment Element      | Checkout supports subscriptions out of box. Payment Element requires manual Subscriptions API integration. Checkout recommended for most subscription use cases per Stripe docs. |
| Webhook testing     | Stripe CLI               | ngrok + manual setup | Stripe CLI built for this use case. Provides signing secrets, event triggering, event filtering. Faster dev workflow.                                                            |

## What NOT to Use

| Avoid                                   | Why                         | Use Instead                   |
| --------------------------------------- | --------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| @types/stripe                           | Redundant                   | stripe package includes types | The stripe@20.x package has built-in TypeScript definitions. Installing @types/stripe causes conflicts.                                                                             |
| Payment Intents API (for subscriptions) | More work, missing features | Checkout Sessions API         | Payment Intents requires manual Subscriptions API, Tax API integration. Checkout Sessions provides complete subscription flow including trials, billing addresses, tax calculation. |
| Synchronous webhook processing          | Scalability issues          | Async queue pattern           | Large webhook spikes (e.g., month-start renewals) will overwhelm synchronous handlers. Queue webhooks for async processing at rate your system supports.                            |
| Skipping signature verification         | Security vulnerability      | Always verify signatures      | `stripe.webhooks.constructEvent()` validates webhook authenticity. Never skip in production. Prevents webhook forgery attacks.                                                      |
| Custom Stripe API version (old)         | Type mismatches             | Use latest API version        | stripe-node types reflect latest API shape. Using old API versions requires `// @ts-ignore` comments and loses type safety.                                                         |

## Stack Patterns by Variant

**If using Stripe Customer Portal (RECOMMENDED):**

- Use Stripe-hosted billing management
- Generate portal session via API: `stripe.billingPortal.sessions.create()`
- Minimal custom billing UI needed
- Customers manage subscriptions, payment methods, invoices self-service
- Configure features in Stripe Dashboard (cancellation, plan changes, invoice history)

**If building custom billing UI:**

- Use Checkout Sessions for initial subscription creation
- Use Subscriptions API for programmatic updates
- Use Payment Element for custom payment flows
- More development effort, more control over UX
- Still recommend Customer Portal for customer self-service

## Integration Architecture

### Recommended Flow

1. **Subscription Creation**: Checkout Sessions API

   - Create session with line items (price IDs)
   - Set trial period: 14 days
   - Redirect user to Stripe-hosted checkout
   - Handle success/cancel URLs

2. **Webhook Processing**: Event-driven updates

   - Verify signature with `constructEvent()`
   - Process key events asynchronously:
     - `checkout.session.completed` - subscription created
     - `customer.subscription.updated` - plan changed
     - `customer.subscription.deleted` - subscription cancelled
     - `invoice.payment_succeeded` - successful payment
     - `invoice.payment_failed` - failed payment
   - Update local MongoDB with subscription status
   - Return 200 immediately (process async)

3. **Plan Enforcement**: Middleware pattern

   - Check subscription status before route handlers
   - Fastify preHandler hook: validate account tier limits
   - Use metadata on Stripe Subscription for custom limits
   - Metadata allows up to 50 keys, values up to 500 chars

4. **Billing Management**: Customer Portal
   - Generate portal session when user clicks "Manage Billing"
   - Stripe handles plan changes, cancellations, payment updates
   - Configure allowed actions in Stripe Dashboard
   - Webhooks notify your app of changes

### Stripe as Source of Truth

**Key principle**: Minimize billing logic in your database. Use Stripe as the single source of truth.

**Store in MongoDB (minimal)**:

- `account.stripeCustomerId` - link to Stripe customer
- `account.stripeSubscriptionId` - current subscription ID
- `account.currentPlan` - cached for quick access (Free/Pro/Team)
- `account.planLimits` - cached limits for enforcement
- `account.subscriptionStatus` - cached status (trialing/active/past_due/canceled)

**Query Stripe for**:

- Payment history
- Invoice details
- Upcoming invoice preview
- Usage records (if metered billing)

**Sync pattern**: Webhooks update cached MongoDB values. Never store full payment/invoice data locally.

## Version Compatibility

| Package                 | Compatible With | Notes                                                                                                     |
| ----------------------- | --------------- | --------------------------------------------------------------------------------------------------------- |
| stripe@20.3.1           | Node.js 12+     | Node 16 support deprecated, will be removed in future major version. Recommend Node 18+ for new projects. |
| fastify-stripe@2.0.0    | fastify@4.x     | Check compatibility with Fastify v5 if upgrading. Plugin updated less frequently than Fastify core.       |
| @fastify/raw-body@5.0.0 | fastify@4.x     | Required for webhook signature verification. Must be registered before routes.                            |

## Configuration

### Environment Variables

```bash
# Required
STRIPE_SECRET_KEY=sk_test_...        # From Stripe Dashboard
STRIPE_WEBHOOK_SECRET=whsec_...      # From Stripe Dashboard (production)
                                     # From CLI output (development)

# Optional
STRIPE_MAX_NETWORK_RETRIES=3         # Default: 1 (added in SDK v13+)
STRIPE_TIMEOUT_MS=80000              # Default: 80000 (80 seconds)
STRIPE_API_VERSION=2025-06-30.basil  # Explicit API version (optional)
```

### Fastify Plugin Registration

```typescript
import fastifyStripe from "fastify-stripe";

await fastify.register(fastifyStripe, {
  apiKey: process.env.STRIPE_SECRET_KEY,
  maxNetworkRetries: 3, // Auto-retry safe requests
  timeout: 80000,
  // apiVersion: '2025-06-30.basil' // Optional: flexible billing mode
});

// Access via decorator
const customer = await fastify.stripe.customers.create({
  email: user.email,
  metadata: { accountId: account.id },
});
```

### Webhook Route with Raw Body

```typescript
import rawBody from "@fastify/raw-body";

// Register raw body parser before routes
await fastify.register(rawBody);

fastify.post("/webhooks/stripe", async (request, reply) => {
  const signature = request.headers["stripe-signature"];

  try {
    // Verify webhook signature
    const event = fastify.stripe.webhooks.constructEvent(
      request.rawBody, // Provided by @fastify/raw-body
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    );

    // Process event asynchronously
    await webhookQueue.add(event);

    return reply.status(200).send({ received: true });
  } catch (err) {
    fastify.log.error("Webhook signature verification failed:", err);
    return reply
      .status(400)
      .send({ error: "Webhook signature verification failed" });
  }
});
```

## Key Stripe Concepts

### Products and Prices

- **Product**: What you're selling (e.g., "Pro Plan")
- **Price**: How much and how often (e.g., "$29/month")
- Create in Stripe Dashboard or API
- Reference by Price ID in Checkout Sessions
- Can have multiple prices per product (monthly/yearly)

### Subscriptions

- Attach to Stripe Customer
- Status: trialing → active → past_due → canceled
- Trial period: max 730 days (2 years)
- Metadata: store custom data (plan limits, feature flags)
- Limit: 20 products per subscription

### Checkout Sessions

- Stripe-hosted payment page
- Supports subscriptions, one-time payments, both
- Handles trials, billing addresses, tax calculation
- Success/cancel redirect URLs
- Mode: 'subscription' for recurring billing

### Customer Portal

- Stripe-hosted billing management
- Configure in Dashboard: allowed actions, cancellation reasons, retention coupons
- Generate session via API, redirect customer
- Handles: plan changes, cancellations, payment methods, invoices, tax IDs

### Webhooks

- HTTPS POST to your endpoint
- Event object (type, data, created timestamp)
- Must verify signature (prevents forgery)
- Idempotent processing (Stripe may retry)
- Async processing recommended (scalability)

## Testing Strategy

### Local Development

```bash
# Login to Stripe
stripe login

# Forward webhooks to local server
stripe listen --forward-to http://localhost:3000/webhooks/stripe

# Copy webhook signing secret from CLI output to .env
# STRIPE_WEBHOOK_SECRET=whsec_...

# Trigger test events
stripe trigger checkout.session.completed
stripe trigger customer.subscription.updated
stripe trigger invoice.payment_failed
```

### Test Mode Best Practices

1. Use test API keys (sk*test*..., pk*test*...)
2. Use test card numbers (4242 4242 4242 4242)
3. Use Test Clocks for time-based scenarios
4. Test mode data auto-deleted after 90 days
5. Webhook signing secret differs from production

### Key Test Scenarios

- Free trial → paid subscription conversion
- Payment failure during trial (no payment method)
- Payment failure during active subscription
- Plan upgrade/downgrade (proration)
- Subscription cancellation (immediate vs end of period)
- Subscription reactivation
- Payment method update

## Subscription Events Reference

### Critical Events (Must Handle)

| Event                         | When Triggered          | Action Required                                                      |
| ----------------------------- | ----------------------- | -------------------------------------------------------------------- |
| checkout.session.completed    | User completes checkout | Create/update account, store Stripe IDs, activate trial/subscription |
| customer.subscription.updated | Subscription changed    | Update cached plan, limits, status                                   |
| customer.subscription.deleted | Subscription cancelled  | Downgrade to Free plan, disable paid features                        |
| invoice.payment_succeeded     | Payment successful      | Update payment status, extend access                                 |
| invoice.payment_failed        | Payment failed          | Send notification, grace period, or suspend                          |

### Recommended Events (Should Handle)

| Event                                | When Triggered           | Action Required                                  |
| ------------------------------------ | ------------------------ | ------------------------------------------------ |
| customer.subscription.trial_will_end | 3 days before trial ends | Send reminder email                              |
| invoice.upcoming                     | 1 week before renewal    | Preview upcoming charge notification             |
| customer.updated                     | Customer info changed    | Update cached customer data                      |
| payment_method.attached              | New payment method       | Update payment status if subscription was paused |

## Confidence Levels

| Component             | Confidence | Rationale                                                                               |
| --------------------- | ---------- | --------------------------------------------------------------------------------------- |
| stripe@20.3.1         | HIGH       | Official Stripe package, verified via npm search, actively maintained, stable API       |
| fastify-stripe        | HIGH       | Official Fastify ecosystem plugin, verified GitHub repo, actively maintained            |
| Checkout Sessions API | HIGH       | Stripe official docs, recommended approach for subscriptions per official documentation |
| Customer Portal       | HIGH       | Stripe official feature, reduces custom billing UI development significantly            |
| Webhook patterns      | HIGH       | Official Stripe webhooks documentation, verified implementation patterns                |
| @fastify/raw-body     | MEDIUM     | Verified Fastify plugin, GitHub issues confirm usage pattern for Stripe webhooks        |
| stripe-event-types    | MEDIUM     | Community package, need to verify compatibility with stripe@20.x, optional enhancement  |
| Test Clocks           | HIGH       | Official Stripe testing feature, available in Dashboard, well-documented                |

## Sources

### Official Documentation (HIGH Confidence)

- [Stripe Node.js SDK](https://github.com/stripe/stripe-node) - Official SDK repository
- [Stripe SDK Latest Version](https://www.npmjs.com/package/stripe) - Version 20.3.1 verified
- [Build a subscriptions integration](https://docs.stripe.com/billing/subscriptions/build-subscriptions) - Official integration guide
- [Stripe Webhooks Documentation](https://docs.stripe.com/webhooks) - Official webhook setup
- [Using webhooks with subscriptions](https://docs.stripe.com/billing/subscriptions/webhooks) - Subscription-specific webhook events
- [Stripe Customer Portal](https://docs.stripe.com/customer-management) - Self-service billing management
- [Stripe Test Clocks](https://docs.stripe.com/billing/testing/test-clocks) - Time-based testing
- [Stripe CLI Documentation](https://docs.stripe.com/stripe-cli) - Local development tools
- [Stripe Metadata](https://docs.stripe.com/metadata) - Custom data storage on Stripe objects
- [Use trial periods on subscriptions](https://docs.stripe.com/billing/subscriptions/trials) - Free trial implementation
- [Checkout vs Payment Element](https://support.stripe.com/questions/choosing-between-payment-links-invoicing-checkout-and-payment-element) - When to use each

### Community Resources (MEDIUM Confidence)

- [fastify-stripe GitHub](https://github.com/coopflow/fastify-stripe) - Fastify Stripe plugin
- [Integrate Stripe with Fastify](https://backend.cafe/integrate-stripe-with-fastify) - Integration tutorial
- [Fastify Webhook Issues](https://github.com/fastify/help/issues/158) - Raw body requirement discussion
- [Stripe Event Types](https://github.com/kgajera/stripe-event-types) - Enhanced TypeScript types

### Architecture References (MEDIUM Confidence)

- [Stripe Subscription Integration Guide](https://dev.to/ivanivanovv/stripe-subscription-integration-in-nodejs-2024-ultimate-guide-2ba3) - Node.js patterns
- [Stripe-First Architecture](https://medium.com/@jealousgx/streamlining-subscription-payments-with-stripe-a-node-js-integration-444c2f28a249) - Single source of truth pattern

---

_Stack research for: GitLaunch Subscription Billing_
_Researched: 2026-02-08_
_Confidence: HIGH_
