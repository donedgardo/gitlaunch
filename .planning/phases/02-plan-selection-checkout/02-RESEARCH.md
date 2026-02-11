# Phase 02: Plan Selection & Checkout - Research

**Researched:** 2026-02-10
**Domain:** Stripe Checkout Sessions, Customer Portal, SaaS Plan Selection UI
**Confidence:** HIGH

## Summary

Phase 2 builds on the billing foundation from Phase 1 to add user-facing plan selection and subscription flows. The research reveals three key implementation areas: (1) Stripe Checkout Sessions for hosted payment collection, (2) Stripe Customer Portal for self-service billing management, and (3) plan picker UI patterns for SaaS applications.

The existing codebase already has the foundation (MembershipService interface, StripeService, webhook handlers, idempotency) but needs expansion to support three distinct plans (Free/Pro/Team) instead of the current binary Free/Paid model. The key technical challenge is migrating the Plan enum and associated limits while maintaining backward compatibility with Phase 1's webhook handlers.

**Primary recommendation:** Expand Plan enum to `Free | Pro | Team`, add plan-aware checkout session creation with multiple price IDs, build HTMX-based plan picker that redirects to Stripe Checkout via HX-Redirect header, and create billing settings page showing usage + Customer Portal link.

## Standard Stack

### Core

| Library      | Version | Purpose                   | Why Standard                                                                           |
| ------------ | ------- | ------------------------- | -------------------------------------------------------------------------------------- |
| stripe       | ^20.3.1 | Stripe SDK for Node.js    | Official Stripe library, already in package.json, provides typed API access            |
| HTMX         | via CDN | Client-side interactivity | Already used throughout app for partial updates, perfect for form-based plan selection |
| Handlebars   | ^4.7.8  | Server-side templating    | Already used for all UI templates, consistent with existing patterns                   |
| Tailwind CSS | ^3.4.1  | Styling framework         | Already configured, all UI uses Tailwind utility classes                               |

### Supporting

| Library          | Version | Purpose                 | When to Use                                                            |
| ---------------- | ------- | ----------------------- | ---------------------------------------------------------------------- |
| fastify-raw-body | ^5.0.0  | Access raw request body | Already registered, required for Stripe webhook signature verification |
| MongoDB          | ^6.5.0  | Data persistence        | Already used for Account model, stores plan and Stripe metadata        |

### Alternatives Considered

| Instead of       | Could Use           | Tradeoff                                                                                    |
| ---------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| Stripe Checkout  | Stripe Elements     | Elements = custom UI + more control, but Checkout = hosted, PCI-compliant, less maintenance |
| HTMX redirects   | Client-side JS      | JS redirect would work but breaks HTMX-first pattern already established                    |
| Three-tier plans | Usage-based pricing | Usage-based more complex, Phase requirements specify tier-based Free/Pro/Team               |

**Installation:**

```bash
# No new packages needed - all dependencies already installed
# Stripe SDK already at ^20.3.1
# HTMX, Handlebars, Tailwind already configured
```

## Architecture Patterns

### Recommended Project Structure

```
src/
├── repositories/
│   └── accountRepository.ts        # Update Plan enum: Free | Pro | Team
├── services/billing/
│   ├── stripeService.ts            # Plan-aware checkout session creation
│   ├── planEnforcementService.ts   # Multi-tier limit enforcement
│   └── webhookHandler.ts           # Map priceId → plan in checkout.session.completed
├── server/routes/
│   ├── onboarding/
│   │   └── plan-selection.ts       # NEW: Plan picker after signup
│   ├── settings/
│   │   └── billing.ts              # Expand with Customer Portal link
│   └── webhooks/
│       └── stripe.ts               # Already handles checkout.session.completed
└── templates/
    ├── onboarding/
    │   └── plan-selection.hbs      # NEW: Plan comparison UI
    └── settings/
        └── billing.hbs             # NEW: Current plan + usage + portal link
```

### Pattern 1: Stripe Checkout Session Creation (Plan-Aware)

**What:** Create Checkout Session with correct priceId based on user's plan choice
**When to use:** User clicks "Subscribe" button from plan picker or billing page
**Example:**

```typescript
// Source: Codebase (src/services/billing/stripeService.ts) + Stripe docs
// Current implementation uses fixed proPriceId - needs to be plan-aware

export type StripeServiceConfig = {
  proPriceId: string;
  teamPriceId: string;  // ADD THIS
  successUrl: string;
  cancelUrl: string;
};

async createCheckoutSession(params: {
  account: Account;
  userEmail: string | null;
  plan: Plan;  // ADD THIS - specify which plan to subscribe to
}): Promise<CheckoutSessionResult> {
  const priceId = params.plan === Plan.Team
    ? this.config.teamPriceId
    : this.config.proPriceId;

  const checkoutParams = {
    priceId,
    successUrl: this.config.successUrl,
    cancelUrl: this.config.cancelUrl,
    metadata: {
      accountId: params.account._id.toString(),
      plan: params.plan,  // Include plan for webhook processing
    },
    customerId: params.account.stripeCustomerId,
    customerEmail: params.userEmail,
  };

  return await this.stripeClient.createCheckoutSession(checkoutParams);
}
```

**Source:** [Stripe Checkout Sessions API](https://docs.stripe.com/api/checkout/sessions/create)

### Pattern 2: Stripe Customer Portal Integration

**What:** Generate Stripe-hosted URL for customers to manage billing
**When to use:** User clicks "Manage Billing" from settings page
**Example:**

```typescript
// Source: Codebase (src/services/billing/stripeService.ts) + Stripe docs
// Already implemented - just needs UI integration

async createBillingPortalSession(params: {
  account: Account;
  returnUrl: string;
}): Promise<{ url: string }> {
  if (!params.account.stripeCustomerId) {
    throw new Error("Account has no Stripe customer");
  }

  return this.stripeClient.createBillingPortalSession({
    customerId: params.account.stripeCustomerId,
    returnUrl: params.returnUrl,
  });
}
```

**Customer Portal provides:** Update payment method, view invoices, cancel subscription, download receipts
**Source:** [Stripe Customer Portal Integration](https://docs.stripe.com/customer-management/integrate-customer-portal)

### Pattern 3: HTMX External Redirect (for Stripe Checkout)

**What:** Redirect to external Stripe Checkout URL from HTMX form POST
**When to use:** User submits plan selection form and needs to go to Stripe's hosted page
**Example:**

```typescript
// Server-side route handler
app.post("/api/billing/checkout", async (request, reply) => {
  const result = await stripeService.createCheckoutSession({
    account: request.account,
    userEmail: request.userEmail,
    plan: request.body.plan, // "pro" or "team"
  });

  // Use HX-Redirect header to trigger full-page redirect
  reply.header("HX-Redirect", result.url);
  return reply.status(200).send();
});
```

```html
<!-- Client-side HTMX form -->
<form hx-post="/api/billing/checkout" hx-target="body">
  <input type="hidden" name="plan" value="pro" />
  <button type="submit">Subscribe to Pro</button>
</form>
```

**Source:** [HTMX HX-Redirect Response Header](https://htmx.org/headers/hx-redirect/)

### Pattern 4: Plan Picker UI (SaaS Pricing Table)

**What:** Comparison table showing Free/Pro/Team with features and CTAs
**When to use:** After signup (new users) or from billing settings (existing users)
**Example:**

```html
<!-- Source: Existing landing page (src/templates/index.hbs) + SaaS UX research -->
<div class="grid md:grid-cols-3 gap-8">
  <!-- Free Tier -->
  <div class="bg-white rounded-2xl border p-8">
    <h3 class="text-lg font-semibold">Free</h3>
    <div class="mt-6">
      <span class="text-4xl font-bold">$0</span>
      <span class="text-gray-600">/month</span>
    </div>
    <ul class="mt-8 space-y-4">
      <li>✓ 3 public repositories</li>
      <li>✓ 3 services</li>
      <li>✓ 1 team member</li>
    </ul>
    <form hx-post="/onboarding/select-plan" hx-target="body">
      <input type="hidden" name="plan" value="free" />
      <button class="mt-8 w-full py-3 bg-gray-100 rounded-lg">
        Continue with Free
      </button>
    </form>
  </div>

  <!-- Pro Tier (highlighted) -->
  <div class="bg-blue-600 rounded-2xl p-8">
    <div
      class="absolute -top-4 px-4 py-1 bg-blue-500 text-white text-sm rounded-full"
    >
      Most Popular
    </div>
    <h3 class="text-lg font-semibold text-white">Pro</h3>
    <div class="mt-6">
      <span class="text-4xl font-bold text-white">$19</span>
      <span class="text-blue-100">/month</span>
    </div>
    <ul class="mt-8 space-y-4 text-white">
      <li>✓ 10 repositories (public + private)</li>
      <li>✓ 10 services</li>
      <li>✓ 5 team members</li>
      <li>✓ Monorepo support</li>
    </ul>
    <form hx-post="/api/billing/checkout" hx-target="body">
      <input type="hidden" name="plan" value="pro" />
      <button class="mt-8 w-full py-3 bg-white text-blue-600 rounded-lg">
        Start 14-Day Trial
      </button>
    </form>
  </div>

  <!-- Team Tier -->
  <div class="bg-white rounded-2xl border p-8">
    <!-- Similar structure -->
  </div>
</div>
```

**Key UX principles:** 3-column grid on desktop, stack on mobile, highlight recommended tier, clear feature differentiation, CTA in each card
**Sources:**

- [SaaS Pricing Page Best Practices 2026](https://www.designstudiouiux.com/blog/saas-pricing-page-design-best-practices/)
- [Pricing Page UX Research](https://userpilot.com/blog/pricing-page-best-practices/)

### Pattern 5: Webhook Metadata for Plan Mapping

**What:** Include plan in checkout session metadata, read in webhook handler
**When to use:** Map completed checkout to correct plan (Pro vs Team)
**Example:**

```typescript
// In webhook handler (src/server/routes/webhooks/stripe.ts)
case "checkout.session.completed": {
  const session = event.data.object;
  const plan = session.metadata.plan || "pro";  // Read from metadata

  await webhookHandler.handleCheckoutCompleted({
    accountId: session.metadata.accountId,
    customerId: session.customer,
    subscriptionId: session.subscription,
    plan: plan as Plan,  // Pass plan to handler
  });
  break;
}

// In handler (src/services/billing/webhookHandler.ts)
async handleCheckoutCompleted(event: CheckoutCompletedEvent): Promise<void> {
  const accountId = new ObjectId(event.accountId);
  await this.accountRepo.upgradeToPlan(  // NEW method
    accountId,
    event.customerId,
    event.subscriptionId,
    event.plan,  // "pro" or "team"
  );
}
```

**Alternative approach:** Look up subscription → price → map to plan (more fragile, requires config)
**Recommended:** Use metadata (simpler, explicit, no config dependency)
**Source:** [Stripe Checkout Session Metadata](https://docs.stripe.com/api/checkout/sessions/object#checkout_session_object-metadata)

### Anti-Patterns to Avoid

- **Hard-coding price IDs in templates:** Price IDs should come from server config/env vars, not HTML
- **Skipping webhook verification:** Phase 1 already handles this correctly - continue using signature verification
- **Client-side plan enforcement:** Never trust client to enforce limits - always validate server-side
- **Mixing Free trial activation with payment:** Free tier = no payment required, paid tiers = trial starts WITHOUT payment (14 days), payment collected when trial ends
- **Using 302 redirects with HTMX:** Use HX-Redirect header instead - 302 responses don't pass headers to HTMX
- **Exposing Stripe customer/subscription IDs to client:** Keep these server-side only

## Don't Hand-Roll

| Problem                        | Don't Build                                  | Use Instead                      | Why                                                                      |
| ------------------------------ | -------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| Payment form UI                | Custom credit card fields                    | Stripe Checkout                  | PCI compliance, 3D Secure, localization, mobile optimization all handled |
| Billing portal                 | Custom "update card" + "view invoices" pages | Stripe Customer Portal           | Self-service management, invoice download, payment method updates        |
| Webhook signature verification | Custom HMAC validation                       | Stripe SDK `constructEvent()`    | Handles timestamp validation, signature verification, event construction |
| Plan limit calculations        | Ad-hoc `if (count > limit)` checks           | PlanEnforcementService (Phase 1) | Already built, tested, centralized                                       |
| Subscription state management  | Custom renewal tracking                      | Stripe webhooks + Account model  | Stripe sends invoice.paid, subscription.deleted automatically            |

**Key insight:** Stripe's hosted solutions (Checkout, Customer Portal) eliminate entire categories of edge cases (failed payments, retry logic, localization, mobile UX, security). Building custom would require 10x more code for worse UX.

## Common Pitfalls

### Pitfall 1: Plan Enum Migration Without Backward Compatibility

**What goes wrong:** Changing Plan enum from `Free | Paid` to `Free | Pro | Team` breaks existing webhooks, tests, and upgrade logic
**Why it happens:** Direct find-replace without considering existing data and webhook handlers
**How to avoid:**

1. Add Pro and Team to enum first
2. Update `upgradeToPaid()` to `upgradeToPlan(plan: Plan)` with backward-compatible signature
3. Map webhook price IDs to correct plan (not just "paid")
4. Update tests to cover all three plans
5. Consider migration script for existing "paid" accounts (or leave as-is if acceptable)

**Warning signs:** Tests failing with "Plan.Paid is not assignable to type Plan", webhooks upgrading Team subscribers to wrong limits

### Pitfall 2: Missing Plan Parameter in Checkout Session

**What goes wrong:** User subscribes to Team plan, webhook receives checkout.session.completed, but handler doesn't know which plan they selected, upgrades them to Pro
**Why it happens:** Forgetting to pass plan through metadata or relying on implicit mapping
**How to avoid:**

- Always include `plan` in checkout session metadata
- Read `session.metadata.plan` in webhook handler
- Validate plan value (type guard: `plan === "pro" || plan === "team"`)
- Default to Pro only as fallback (log error)

**Warning signs:** User pays $49/month but gets Pro limits ($19 plan), Stripe shows correct subscription but app shows wrong plan

### Pitfall 3: Trial Period Confusion

**What goes wrong:** User selects "Start 14-Day Trial" but is immediately charged, or trial starts but no Stripe subscription exists
**Why it happens:** Misunderstanding difference between (a) Free tier with no payment, (b) Trial with deferred payment, (c) Immediate payment
**How to avoid:**

- Free tier: No Stripe involvement, just start using app with Free limits
- Pro/Team trial: Stripe Checkout with `trial_period_days: 14` → creates subscription immediately with trial, payment collected after 14 days
- Use Checkout's built-in trial support, don't try to build custom logic

**Requirements state:** "14-day trial on any plan (no credit card)" → This means Free tier is accessible without payment, Pro/Team trials DO require payment method (held until trial ends)
**Clarification needed:** Confirm with user if Pro/Team trials should require card upfront (Stripe best practice) or truly require zero payment method (harder to implement, higher churn)

**Warning signs:** Users complaining about unexpected charges, trial period not showing in Stripe Dashboard, subscription created without trial metadata

### Pitfall 4: HTMX Redirect Not Triggering

**What goes wrong:** User submits plan selection form, server responds with redirect URL, but browser doesn't navigate to Stripe Checkout
**Why it happens:** Using standard 302 redirect instead of HX-Redirect header, or HTMX not configured to handle redirect response
**How to avoid:**

- Server must return `HX-Redirect: <stripe-checkout-url>` header with 200 status
- OR return 303 See Other redirect (browser follows, bypassing HTMX)
- Don't return redirect URL in JSON body expecting client-side JS (breaks no-JS requirement)

**Example:**

```typescript
// ✅ CORRECT
reply.header("HX-Redirect", checkoutUrl);
return reply.status(200).send();

// ❌ WRONG - HTMX won't follow this
return reply.redirect(302, checkoutUrl);

// ❌ WRONG - Requires client JS
return { redirectUrl: checkoutUrl };
```

**Warning signs:** Form submits, network tab shows 200 OK, but no navigation happens; browser console shows no errors

### Pitfall 5: No Customer Portal Link for Free Users

**What goes wrong:** Free tier users see "Manage Billing" link but clicking it errors (no stripeCustomerId)
**Why it happens:** Customer Portal requires Stripe customer, but Free users never go through Checkout
**How to avoid:**

- Only show "Manage Billing" link if `account.stripeCustomerId` exists
- For Free users, show "Upgrade to Pro" CTA instead
- Or show "No active subscription" message with upgrade CTA

**Warning signs:** 400 error "Account has no Stripe customer" on billing page for Free users

## Code Examples

Verified patterns from codebase and official sources:

### Creating Checkout Session (Multi-Plan)

```typescript
// Source: src/services/billing/stripeService.ts (modified)
export class StripeService implements MembershipService {
  constructor(
    private stripeClient: StripeClient,
    private config: {
      proPriceId: string;
      teamPriceId: string; // NEW
      successUrl: string;
      cancelUrl: string;
    },
  ) {}

  async createCheckoutSession(params: {
    account: Account;
    userEmail: string | null;
    plan: Plan; // NEW - specify target plan
  }): Promise<CheckoutSessionResult> {
    // Map plan to price ID
    const priceId = this.getPriceIdForPlan(params.plan);

    const checkoutParams = {
      priceId,
      successUrl: this.config.successUrl,
      cancelUrl: this.config.cancelUrl,
      metadata: {
        accountId: params.account._id.toString(),
        plan: params.plan, // Include for webhook
      },
      customerId: params.account.stripeCustomerId,
      customerEmail: params.userEmail,
    };

    const session =
      await this.stripeClient.createCheckoutSession(checkoutParams);

    return {
      url: session.url,
      sessionId: session.id,
    };
  }

  private getPriceIdForPlan(plan: Plan): string {
    switch (plan) {
      case Plan.Pro:
        return this.config.proPriceId;
      case Plan.Team:
        return this.config.teamPriceId;
      case Plan.Free:
        throw new Error("Cannot create checkout for Free plan");
      default:
        throw new Error(`Unknown plan: ${plan}`);
    }
  }
}
```

### Webhook Handler (Plan-Aware)

```typescript
// Source: src/services/billing/webhookHandler.ts (modified)
export type CheckoutCompletedEvent = {
  accountId: string;
  customerId: string;
  subscriptionId: string;
  plan: Plan; // NEW
};

export class StripeWebhookHandler {
  constructor(private accountRepo: AccountRepository) {}

  async handleCheckoutCompleted(event: CheckoutCompletedEvent): Promise<void> {
    const accountId = new ObjectId(event.accountId);

    // Use plan-specific upgrade method
    await this.accountRepo.upgradeToPlan(
      accountId,
      event.customerId,
      event.subscriptionId,
      event.plan, // Pass specific plan (Pro or Team)
    );
  }
}
```

### Plan Picker Template

```handlebars
{{! Source: UX research + landing page pattern (index.hbs) }}
{{! templates/onboarding/plan-selection.hbs }}
<div class="max-w-7xl mx-auto px-4 py-16">
  <div class="text-center mb-12">
    <h1 class="text-3xl font-bold">Choose Your Plan</h1>
    <p class="text-gray-600 mt-2">Start with a 14-day free trial on any paid
      plan</p>
  </div>

  <div class="grid md:grid-cols-3 gap-8">
    {{! Free Tier }}
    <div class="bg-white rounded-2xl border p-8">
      <h3 class="text-lg font-semibold">Free</h3>
      <div class="mt-6">
        <span class="text-4xl font-bold">$0</span>
        <span class="text-gray-600">/month</span>
      </div>
      <ul class="mt-8 space-y-4 text-gray-600">
        <li class="flex items-center">
          <svg
            class="w-5 h-5 text-green-500 mr-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 13l4 4L19 7"
            ></path>
          </svg>
          3 public repositories
        </li>
        <li class="flex items-center">
          <svg
            class="w-5 h-5 text-green-500 mr-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 13l4 4L19 7"
            ></path>
          </svg>
          3 services
        </li>
        <li class="flex items-center">
          <svg
            class="w-5 h-5 text-green-500 mr-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 13l4 4L19 7"
            ></path>
          </svg>
          1 team member
        </li>
      </ul>
      <form hx-post="/onboarding/select-plan" hx-target="body">
        <input type="hidden" name="plan" value="free" />
        <button
          type="submit"
          class="mt-8 w-full py-3 bg-gray-100 text-gray-900 rounded-lg hover:bg-gray-200"
        >
          Continue with Free
        </button>
      </form>
    </div>

    {{! Pro Tier (highlighted) }}
    <div class="bg-blue-600 rounded-2xl p-8 relative">
      <div
        class="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-blue-500 text-white text-sm font-semibold rounded-full"
      >
        Most Popular
      </div>
      <h3 class="text-lg font-semibold text-white">Pro</h3>
      <div class="mt-6">
        <span class="text-4xl font-bold text-white">$19</span>
        <span class="text-blue-100">/month</span>
      </div>
      <ul class="mt-8 space-y-4 text-white">
        <li class="flex items-center">
          <svg
            class="w-5 h-5 text-blue-200 mr-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 13l4 4L19 7"
            ></path>
          </svg>
          10 repos (public + private)
        </li>
        <li class="flex items-center">
          <svg
            class="w-5 h-5 text-blue-200 mr-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 13l4 4L19 7"
            ></path>
          </svg>
          10 services
        </li>
        <li class="flex items-center">
          <svg
            class="w-5 h-5 text-blue-200 mr-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 13l4 4L19 7"
            ></path>
          </svg>
          5 team members
        </li>
        <li class="flex items-center">
          <svg
            class="w-5 h-5 text-blue-200 mr-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 13l4 4L19 7"
            ></path>
          </svg>
          Monorepo support
        </li>
      </ul>
      <form hx-post="/api/billing/checkout" hx-target="body">
        <input type="hidden" name="plan" value="pro" />
        <button
          type="submit"
          class="mt-8 w-full py-3 bg-white text-blue-600 rounded-lg hover:bg-blue-50"
        >
          Start 14-Day Trial
        </button>
      </form>
    </div>

    {{! Team Tier }}
    <div class="bg-white rounded-2xl border p-8">
      <h3 class="text-lg font-semibold">Team</h3>
      <div class="mt-6">
        <span class="text-4xl font-bold">$49</span>
        <span class="text-gray-600">/month</span>
      </div>
      <ul class="mt-8 space-y-4 text-gray-600">
        <li class="flex items-center">
          <svg
            class="w-5 h-5 text-green-500 mr-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 13l4 4L19 7"
            ></path>
          </svg>
          Unlimited repositories
        </li>
        <li class="flex items-center">
          <svg
            class="w-5 h-5 text-green-500 mr-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 13l4 4L19 7"
            ></path>
          </svg>
          Unlimited services
        </li>
        <li class="flex items-center">
          <svg
            class="w-5 h-5 text-green-500 mr-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 13l4 4L19 7"
            ></path>
          </svg>
          Unlimited team members
        </li>
        <li class="flex items-center">
          <svg
            class="w-5 h-5 text-green-500 mr-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 13l4 4L19 7"
            ></path>
          </svg>
          Priority support
        </li>
      </ul>
      <form hx-post="/api/billing/checkout" hx-target="body">
        <input type="hidden" name="plan" value="team" />
        <button
          type="submit"
          class="mt-8 w-full py-3 bg-gray-100 text-gray-900 rounded-lg hover:bg-gray-200"
        >
          Start 14-Day Trial
        </button>
      </form>
    </div>
  </div>
</div>
```

### Billing Settings Page

```handlebars
{{! templates/settings/billing.hbs }}
<div class="max-w-4xl mx-auto px-4 py-8">
  <h1 class="text-2xl font-bold mb-8">Billing & Usage</h1>

  {{! Current Plan }}
  <div class="bg-white rounded-lg border p-6 mb-6">
    <h2 class="text-lg font-semibold mb-4">Current Plan</h2>
    <div class="flex items-center justify-between">
      <div>
        <p class="text-2xl font-bold">{{plan}}</p>
        {{#if isPaid}}
          <p class="text-gray-600">Next billing date: {{billingDate}}</p>
        {{/if}}
      </div>
      {{#if isPaid}}
        <form hx-post="/api/billing/portal" hx-target="body">
          <input type="hidden" name="returnUrl" value="/settings/billing" />
          <button
            type="submit"
            class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Manage Billing
          </button>
        </form>
      {{else}}
        <a
          href="/onboarding/plan-selection"
          class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Upgrade Plan
        </a>
      {{/if}}
    </div>
  </div>

  {{! Usage }}
  <div class="bg-white rounded-lg border p-6">
    <h2 class="text-lg font-semibold mb-4">Current Usage</h2>
    <div class="space-y-4">
      <div>
        <div class="flex justify-between mb-2">
          <span class="text-gray-600">Repositories</span>
          <span class="font-semibold">{{usage.repositories.current}}
            /
            {{usage.repositories.limit}}</span>
        </div>
        <div class="w-full bg-gray-200 rounded-full h-2">
          <div
            class="bg-blue-600 h-2 rounded-full"
            style="width: {{usage.repositories.percentage}}%"
          ></div>
        </div>
      </div>
      <div>
        <div class="flex justify-between mb-2">
          <span class="text-gray-600">Services</span>
          <span class="font-semibold">{{usage.services.current}}
            /
            {{usage.services.limit}}</span>
        </div>
        <div class="w-full bg-gray-200 rounded-full h-2">
          <div
            class="bg-blue-600 h-2 rounded-full"
            style="width: {{usage.services.percentage}}%"
          ></div>
        </div>
      </div>
      <div>
        <div class="flex justify-between mb-2">
          <span class="text-gray-600">Team Members</span>
          <span class="font-semibold">{{usage.users.current}}
            /
            {{usage.users.limit}}</span>
        </div>
        <div class="w-full bg-gray-200 rounded-full h-2">
          <div
            class="bg-blue-600 h-2 rounded-full"
            style="width: {{usage.users.percentage}}%"
          ></div>
        </div>
      </div>
    </div>
  </div>
</div>
```

## State of the Art

| Old Approach                   | Current Approach                 | When Changed               | Impact                                                     |
| ------------------------------ | -------------------------------- | -------------------------- | ---------------------------------------------------------- |
| Binary plan model (Free/Paid)  | Multi-tier plans (Free/Pro/Team) | Phase 2 requirement        | Need to expand Plan enum, add multiple price IDs           |
| Redirect after payment         | Webhook-driven activation        | Stripe best practice 2020+ | Already implemented in Phase 1                             |
| Custom payment forms           | Stripe Checkout hosted page      | Stripe Checkout v3+        | Simpler PCI compliance, better mobile UX                   |
| Manual subscription management | Customer Portal                  | Stripe feature 2020+       | Self-service reduces support load                          |
| Trial requires credit card     | No-card trials supported         | Stripe 2021+               | Better conversion but requires payment method for Pro/Team |

**Deprecated/outdated:**

- Stripe Checkout v2 (redirect via client-side JS): Now use server-side session creation + redirect
- Hard-coded customer email in Checkout: Use `customer` parameter if customer exists, `customer_email` only for new customers
- Ignoring webhook events: Critical for async payment flows, not optional

## Open Questions

1. **Trial period payment method requirement**

   - What we know: Requirements say "14-day trial on any plan (no credit card required)"
   - What's unclear: Does this mean Pro/Team trials truly require ZERO payment info upfront, or just that they're not charged until day 14?
   - Recommendation: Clarify with user. Stripe best practice = require card for trial (reduces fraud, higher conversion to paid), but user requirement suggests no card needed.

2. **Plan limits for Team tier**

   - What we know: Free has 3/3/1 limits, Pro has 10/10/5, requirements say Team is "unlimited"
   - What's unclear: Should Team be truly unlimited (9999) or a high number (100)?
   - Recommendation: Use high number (e.g., 999) for database sanity, market as "unlimited" in UI

3. **Existing "Paid" accounts migration**

   - What we know: Phase 1 created accounts with `plan: "paid"`, Phase 2 replaces with Pro/Team
   - What's unclear: Should existing "paid" accounts map to Pro or Team? Or leave as-is?
   - Recommendation: If no existing prod data, just delete enum value. If existing data, map to Pro (cheaper option) or add migration script.

4. **Landing page pricing CTAs**
   - What we know: Landing page (index.hbs) shows pricing, all CTAs go to `/auth/github`
   - What's unclear: Should CTAs go directly to plan-specific signup (e.g., `/auth/github?plan=pro`) or keep generic?
   - Recommendation: Add query param support in auth callback to pre-select plan during onboarding

## Sources

### Primary (HIGH confidence)

- [Stripe Checkout Sessions API](https://docs.stripe.com/api/checkout/sessions) - Session creation, metadata, parameters
- [Stripe Customer Portal Integration](https://docs.stripe.com/customer-management/integrate-customer-portal) - Portal session creation, configuration
- [Stripe Subscriptions Overview](https://docs.stripe.com/billing/subscriptions/overview) - Subscription lifecycle, webhooks
- [HTMX HX-Redirect Header](https://htmx.org/headers/hx-redirect/) - External redirect pattern
- Codebase: src/services/billing/stripeService.ts, webhookHandler.ts, planEnforcementService.ts - Verified existing patterns

### Secondary (MEDIUM confidence)

- [SaaS Pricing Page Best Practices 2026](https://www.designstudiouiux.com/blog/saas-pricing-page-design-best-practices/) - UX patterns for plan comparison
- [Pricing Page UX Research](https://userpilot.com/blog/pricing-page-best-practices/) - Mobile optimization, feature lists
- [HTMX Form POST Redirect Patterns](https://hypermedia.systems/htmx-patterns/) - Form handling after POST

### Tertiary (LOW confidence)

- None - all key findings verified with official sources

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - All libraries already installed and used in codebase
- Architecture: HIGH - Patterns verified in existing routes and services, official Stripe docs
- Pitfalls: HIGH - Based on common Stripe integration mistakes + codebase analysis
- UX patterns: MEDIUM - SaaS UX research is current but not specific to this codebase

**Research date:** 2026-02-10
**Valid until:** 60 days (Stripe API stable, SaaS UX patterns slow-moving)
