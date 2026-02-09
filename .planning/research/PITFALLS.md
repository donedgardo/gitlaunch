# Pitfalls Research

**Domain:** SaaS Subscription Billing (Stripe Integration)
**Researched:** 2026-02-08
**Confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: Webhook Event Ordering Race Conditions

**What goes wrong:**
Stripe webhook events don't arrive in chronological order. A `customer.subscription.deleted` event might arrive before `customer.subscription.created`, corrupting your application state. Network conditions cause later events to arrive before earlier ones, and Stripe explicitly does not guarantee delivery order.

**Why it happens:**
Stripe sends multiple events simultaneously, and different network paths have different latencies. Developers assume chronological delivery because that's the logical order, then discover chaos in production when events arrive out of sequence.

**How to avoid:**

- Store the webhook event `created` timestamp in your database
- Use it to discard old events within a database transaction
- Implement async processing: verify signature → queue event → acknowledge receipt immediately
- Never process webhooks inline; always use a job queue (Redis, Bull, etc.)

**Warning signs:**

- Users report being locked out despite successful payment
- Subscription states in your DB don't match Stripe dashboard
- 1% of signups mysteriously fail with no error logs

**Phase to address:**
Phase 1 (Webhook Infrastructure) - Build event ordering and idempotency checks before any subscription logic.

---

### Pitfall 2: Missing Webhook Idempotency

**What goes wrong:**
Stripe sends the same webhook multiple times to guarantee delivery. Without checking for already-processed event IDs, you risk double-charging customers, falsely deactivating accounts, or granting duplicate credits. This affects approximately 1-5% of webhook deliveries.

**Why it happens:**
Network timeouts cause Stripe to retry webhooks. If your handler takes 21 seconds to process (over Stripe's 20-second timeout), Stripe retries while your first handler is still running, causing duplicate processing.

**How to avoid:**

- Create a dedicated `processed_events` collection/table with unique index on `event_id`
- Check if event exists before processing: `if (await isProcessed(event.id)) return 200;`
- Use Stripe's event ID as your idempotency key
- Process webhooks in transactions so partial failures roll back

**Warning signs:**

- Duplicate line items on customer invoices
- Users receive "subscription cancelled" emails twice
- Account balances don't reconcile with Stripe data

**Phase to address:**
Phase 1 (Webhook Infrastructure) - Implement before processing any subscription events.

---

### Pitfall 3: Subscription Status Does Not Guarantee Payment

**What goes wrong:**
A subscription can show `status: 'active'` in Stripe even when the latest invoice is `uncollectible` due to failed payments. Relying solely on subscription status for access control grants paying users and non-paying users the same features.

**Why it happens:**
Stripe separates subscription state (active/canceled/past_due) from payment state (paid/open/uncollectible). A subscription remains `active` even when invoices fail, especially with asynchronous payment methods like ACH Direct Debit that transition to `active` before payment completes.

**How to avoid:**

- Check BOTH subscription status AND latest invoice payment status
- For asynchronous payment methods (ACH, SEPA), validate invoice status separately
- Implement: `hasAccess = subscription.status === 'active' && latestInvoice.status === 'paid'`
- Listen to `invoice.payment_failed` and `invoice.payment_succeeded`, not just subscription status changes

**Warning signs:**

- Revenue doesn't match active subscriber count
- Customers using paid features despite payment method failures
- Stripe dashboard shows "past due" but your app shows "active"

**Phase to address:**
Phase 2 (Access Control Logic) - After webhook infrastructure, before plan enforcement.

---

### Pitfall 4: Trial Period Billing Cycle Reset

**What goes wrong:**
Switching a customer from one monthly subscription to another monthly subscription while introducing a trial period moves the billing date to the conclusion of the trial. This resets your billing cycle, potentially causing unexpected charges or changing expected renewal dates.

**Why it happens:**
Stripe treats trial introduction as a billing cycle reset. Developers add trials mid-subscription without understanding the billing date implications, creating customer confusion about when they'll be charged.

**How to avoid:**

- Never add trial periods to existing subscriptions
- Trials should only apply during initial subscription creation
- If downgrading to a free tier with a trial, schedule it for the next billing period using `subscription_schedule`
- Preview upcoming invoices before making subscription changes: `stripe.invoices.retrieveUpcoming()`

**Warning signs:**

- Customer complaints about "unexpected charge dates"
- Billing cycles no longer align with original sign-up dates
- Support tickets: "I thought I had until [date] before being charged"

**Phase to address:**
Phase 3 (Trial Implementation) - Before enabling free trials, ensure billing cycle logic handles this edge case.

---

### Pitfall 5: Invoice Finalization Delays Freeze Payments

**What goes wrong:**
If Stripe doesn't receive a successful 2xx response to `invoice.created` webhooks, it delays finalizing ALL invoices with automatic collection for up to 72 hours. This creates a payment collection freeze affecting your entire revenue stream.

**Why it happens:**
Developers implement complex business logic inside `invoice.created` handlers that can fail (database timeouts, external API calls, etc.). Stripe interprets any non-2xx response as "don't finalize this invoice yet," freezing your entire billing system.

**How to avoid:**

- Keep `invoice.created` handlers minimal and fast (< 1 second)
- Return 200 immediately, process business logic asynchronously
- Never call external APIs or perform complex database queries in `invoice.created`
- Set up alerts when `invoice.created` webhook latency exceeds 1 second

**Warning signs:**

- Multiple invoices stuck in "draft" status
- No automatic charges for 24-48 hours
- Stripe dashboard shows invoices "pending"
- Revenue drops unexpectedly with no explanation

**Phase to address:**
Phase 1 (Webhook Infrastructure) - Critical foundation issue; handle before any subscription logic.

---

### Pitfall 6: The 23-Hour Payment Window Expiration

**What goes wrong:**
Customers have approximately 23 hours to complete payment after subscription creation. If payment fails or requires 3D Secure and isn't completed within this window, the subscription transitions to `incomplete_expired` and you must create a new subscription from scratch.

**Why it happens:**
Stripe prevents indefinitely pending subscriptions. Customers get distracted during 3D Secure flows, close the browser, or fail payment validation. Without proper handling, these become silent failures with no retry mechanism.

**How to avoid:**

- Use `payment_behavior: 'default_incomplete'` to handle failed payments gracefully
- Listen to `customer.subscription.updated` with status `incomplete_expired`
- Build a flow to re-create subscriptions for expired attempts
- Send reminder emails at 1 hour, 6 hours, and 20 hours after incomplete subscription creation
- Consider extending the window using subscription schedules

**Warning signs:**

- High number of subscriptions in `incomplete_expired` status
- Users complain "I tried to subscribe but nothing happened"
- Conversion funnel drops significantly between payment intent and active subscription

**Phase to address:**
Phase 4 (Payment Flow) - Handle during initial subscription creation implementation.

---

### Pitfall 7: Proration Invoice Masks Unpaid Subscriptions

**What goes wrong:**
When a customer with an unpaid recurring invoice modifies their subscription, proration invoices created can show the subscription as `active` due to the latest successful payment, even if the original recurring invoice remains unpaid. This grants access despite incomplete payment.

**Why it happens:**
Stripe's proration system generates new invoices for subscription changes. If the proration invoice is paid but the original recurring invoice isn't, your "check latest invoice" logic returns the paid proration invoice, masking the unpaid recurring charge.

**How to avoid:**

- Check for BOTH latest invoice AND any open invoices on the customer
- Prevent subscription modifications when subscription status is `past_due`
- Implement: `hasOpenInvoices = customer.invoices.filter(i => i.status === 'open').length > 0`
- Block plan changes if unpaid invoices exist

**Warning signs:**

- Customers downgrade plans to avoid paying original invoice
- Revenue reconciliation shows missing payments
- Users with "past_due" status still using paid features

**Phase to address:**
Phase 5 (Plan Management) - Before enabling upgrades/downgrades.

---

### Pitfall 8: Missing Payment Method Before Trial End

**What goes wrong:**
Trial ends, customer has no payment method attached, subscription either cancels unexpectedly or transitions to `past_due` without the customer knowing. Customer expects to continue using the service, but access is revoked.

**Why it happens:**
Allowing free trials without requiring a payment method reduces friction but creates a payment collection problem at trial end. Developers forget to handle the `customer.subscription.trial_will_end` event (sent 3 days before trial ends) to verify payment method existence.

**How to avoid:**

- Listen to `customer.subscription.trial_will_end` event (arrives 3 days before trial end)
- Check if customer has a default payment method: `customer.invoice_settings.default_payment_method`
- If missing, send email requesting payment method before trial ends
- Configure trial end behavior explicitly: `trial_settings.end_behavior.missing_payment_method`
- Options: `cancel`, `pause`, or `create_invoice` (moves to past_due)

**Warning signs:**

- High trial-to-paid conversion drop-off
- Support tickets: "My account was cancelled without warning"
- Many subscriptions in `past_due` or `canceled` immediately after trial ends

**Phase to address:**
Phase 3 (Trial Implementation) - Essential for trial period handling.

---

### Pitfall 9: Webhook Signature Verification Skipped

**What goes wrong:**
Attackers send fake webhook events to your endpoint, creating fake subscriptions, cancelling real ones, or manipulating billing data. This is a critical security vulnerability that can lead to revenue loss and fraudulent account access.

**Why it happens:**
Developers skip signature verification during development ("I'll add it later") and deploy to production without it. Or they verify signatures but fail silently when verification fails, processing the event anyway.

**How to avoid:**

- ALWAYS verify webhook signatures using `stripe.webhooks.constructEvent()`
- Fail loudly when verification fails - return 400, don't process the event
- Use environment-specific webhook secrets (different for test/production)
- Never trust `req.body` directly - always verify signature first

**Warning signs:**

- Unexpected subscription changes with no corresponding Stripe dashboard activity
- Webhooks triggered for non-existent customers
- Security audit reveals missing signature verification

**Phase to address:**
Phase 1 (Webhook Infrastructure) - First webhook handler implementation must include this.

---

### Pitfall 10: Usage-Based Billing Timestamp Constraints

**What goes wrong:**
Usage events must have timestamps within the past 35 calendar days and not more than 5 minutes in the future. Events outside this window are rejected, causing revenue loss and inaccurate billing. Paused subscriptions silently drop all meter events sent during the pause.

**Why it happens:**
Developers queue usage events for later reporting, exceeding the 35-day window. Clock drift between application servers and Stripe causes future timestamps. Paused subscriptions continue generating usage events that Stripe discards.

**How to avoid:**

- Report usage events as close to real-time as possible (within hours, not days)
- Sync server clocks with NTP to prevent clock drift
- Buffer usage events locally only for short periods (max 24 hours)
- Check subscription status before reporting usage - don't report if `paused`
- Implement retry logic for timestamp rejection errors

**Warning signs:**

- Usage events return 400 errors with "timestamp out of range"
- Customer usage reports don't match actual usage
- Revenue is lower than expected for usage-based features

**Phase to address:**
Phase 6 (Usage Tracking) - If implementing metered billing.

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut                                          | Immediate Benefit                         | Long-term Cost                                                                                            | When Acceptable                                 |
| ------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Store only Stripe subscription ID, not full state | Simpler data model                        | Requires API call for every access check; rate limit issues; fails if Stripe is down                      | Never - always cache subscription state locally |
| Process webhooks synchronously                    | Easier to debug initially                 | Slow webhook processing causes Stripe retries and duplicate events; locks database during long operations | Never - always use async job queue              |
| Skip `invoice.payment_failed` retry logic         | Faster initial implementation             | Permanent revenue loss from temporary payment failures                                                    | Never - implement from day 1                    |
| Use subscription status alone for access control  | Simple boolean check                      | Grants access to non-paying users; revenue leakage                                                        | Never - check invoice status too                |
| Allow subscription changes during `past_due`      | Better UX (user can "fix" by downgrading) | Proration invoices mask unpaid invoices; accounting nightmare                                             | Never - block changes until paid                |
| Hard-code plan limits in application code         | No database schema changes needed         | Cannot change limits without deployment; inconsistent enforcement                                         | Only for MVP, must refactor before launch       |

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration        | Common Mistake                                                 | Correct Approach                                                                                             |
| ------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Stripe Webhooks    | Calling Stripe API inside webhook handler to "verify" event    | Trust webhook data; use `event.data.object` directly; Stripe already verified it                             |
| Stripe API Calls   | Not handling rate limits (100 req/sec read, 100 req/sec write) | Implement exponential backoff; cache subscription data locally; use webhooks instead of polling              |
| MongoDB Storage    | Storing subscription as nested object in user document         | Separate `subscriptions` collection with userId index for efficient queries and webhook updates              |
| Payment Methods    | Assuming payment method is always a card                       | Handle ACH, SEPA, and other async methods differently - they transition to `active` before payment completes |
| Test Mode vs. Live | Using same webhook endpoint for test and live modes            | Separate endpoints; test webhooks contain fake data that doesn't correlate to subscriptions                  |
| Customer Portal    | Redirecting to Stripe portal without session validation        | Generate portal session server-side; validate return URL; never trust client-side portal access              |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap                                                      | Symptoms                                                      | Prevention                                                                                    | When It Breaks              |
| --------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------- |
| Fetching full subscription from Stripe on every page load | Slow page loads; Stripe rate limit errors                     | Cache subscription in MongoDB; update via webhooks; only refresh on user action               | 100+ active users           |
| Processing webhooks synchronously in HTTP handler         | Webhook timeouts (20s limit); Stripe retries cause duplicates | Queue webhooks with Redis/Bull; return 200 immediately; process async                         | 1,000+ subscriptions        |
| Querying Stripe API to check plan limits                  | API latency adds 200-500ms to every request; rate limits      | Store plan limits in MongoDB; reference in-memory; update via admin panel                     | Any scale - slow from day 1 |
| Not using database transactions for webhook processing    | Race conditions corrupt subscription state                    | Wrap all webhook database updates in transactions; use `findOneAndUpdate` with version checks | 10,000+ events/day          |
| Storing all invoice history in single customer document   | Document size exceeds 16MB MongoDB limit; slow queries        | Separate `invoices` collection; index by customerId and status                                | 1 year of operation         |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake                                                 | Risk                                                                          | Prevention                                                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Not verifying webhook signatures                        | Attackers can create fake subscriptions, cancel real ones, manipulate billing | Always use `stripe.webhooks.constructEvent()` with webhook secret; fail on verification error |
| Exposing Stripe API keys in client code                 | Full account takeover; unauthorized charges; data theft                       | Never send secret keys to client; use Publishable Key only; restrict key permissions          |
| Allowing users to set their own subscription price      | Revenue loss; free access to paid features                                    | Always create subscriptions server-side; validate price IDs against known values              |
| Not validating customer ID ownership                    | User A can cancel User B's subscription                                       | Always check `subscription.metadata.userId` matches authenticated user before modifications   |
| Storing webhook secrets in environment without rotation | Compromised secrets grant long-term access                                    | Rotate webhook secrets quarterly; use secrets manager (AWS Secrets Manager, HashiCorp Vault)  |
| Trusting client-side plan selection                     | Users manipulate requests to subscribe to wrong plans                         | Server validates plan selection against allowed plans for user's context                      |

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall                                        | User Impact                                                     | Better Approach                                                                                |
| ---------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| No warning before trial ends                   | Surprise charges; chargebacks; cancellations                    | Send emails at 7 days, 3 days, 1 day before trial end; show in-app countdown                   |
| Unclear proration on plan changes              | Confusion about charges; "I was charged twice this month"       | Preview upcoming invoice before confirming plan change; show exact amounts                     |
| Immediate access revocation on payment failure | Users lose work in progress; data loss; frustration             | Grace period (3-7 days) with prominent payment update banner; retain read-only access          |
| No explanation for cancelled subscription      | "Why was I cancelled?" support tickets                          | Send email explaining reason (payment failed, trial ended, user action); provide recovery link |
| Auto-downgrade without notification            | Users discover missing features mid-task                        | Email before downgrade; in-app warning during trial; confirm downgrade action                  |
| Complex cancellation flow                      | Regulatory violations (FTC dark patterns); customer frustration | One-click cancellation; no "are you sure" loops; transparent process                           |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Webhook Handler:** Often missing idempotency check - verify event ID stored before processing
- [ ] **Subscription Creation:** Often missing `payment_behavior: 'default_incomplete'` - verify incomplete payment handling exists
- [ ] **Access Control:** Often missing invoice status check - verify both subscription AND invoice status checked
- [ ] **Trial Period:** Often missing `trial_will_end` handler - verify 3-day warning event listener exists
- [ ] **Plan Changes:** Often missing proration preview - verify upcoming invoice shown before confirmation
- [ ] **Payment Failures:** Often missing retry logic - verify `invoice.payment_failed` triggers retry/email flow
- [ ] **Webhook Security:** Often missing signature verification - verify `stripe.webhooks.constructEvent()` used
- [ ] **Test Coverage:** Often only tests happy path - verify failed payments, expired cards, webhook retries tested
- [ ] **Database Transactions:** Often missing atomicity - verify webhook handlers use transactions for state updates
- [ ] **Rate Limiting:** Often missing exponential backoff - verify Stripe API calls handle 429 responses
- [ ] **Customer Communication:** Often missing billing update emails - verify users notified of all subscription changes
- [ ] **Tax Collection:** Often missing tax calculation - verify tax compliance for user jurisdictions (Stripe Tax integration)

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall                                            | Recovery Cost | Recovery Steps                                                                                                                                                                                                 |
| -------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Webhook race condition corrupted state             | MEDIUM        | 1. Stop webhook processing; 2. Export subscription list from Stripe; 3. Compare with MongoDB state; 4. Write migration script to fix mismatches; 5. Re-enable webhooks with ordering checks                    |
| Double-charged customer due to missing idempotency | LOW           | 1. Identify duplicate charges via `event_id` correlation; 2. Issue refunds through Stripe dashboard; 3. Email customers explaining error and refund; 4. Add idempotency before processing more webhooks        |
| Granted access to non-paying users                 | MEDIUM        | 1. Query all subscriptions where `subscription.status = 'active'` but `latest_invoice.status != 'paid'`; 2. Revoke access; 3. Email users requesting payment update; 4. Fix access control logic to check both |
| Trial period reset billing cycles                  | HIGH          | 1. Export affected subscriptions; 2. Manually adjust billing anchor dates via API; 3. Notify customers of corrected billing dates; 4. Prevent trial addition to existing subscriptions                         |
| Invoice finalization freeze                        | HIGH          | 1. Fix `invoice.created` webhook handler immediately; 2. Manually finalize draft invoices via Stripe dashboard; 3. Monitor finalization delays; 4. Set up alerting for future freezes                          |
| Missing payment method at trial end                | LOW           | 1. Transition subscriptions to `paused` instead of `canceled`; 2. Email customers requesting payment method; 3. Provide reactivation link; 4. Implement `trial_will_end` handler                               |
| Proration masking unpaid invoices                  | HIGH          | 1. Query all customers with multiple open invoices; 2. Block subscription changes for these customers; 3. Send payment requests for open invoices; 4. Add open invoice check before allowing changes           |
| Unverified webhook signatures                      | HIGH          | 1. Audit all subscription changes in last 7 days; 2. Compare with Stripe dashboard events; 3. Identify and reverse fraudulent events; 4. Deploy signature verification immediately                             |
| Usage events outside timestamp window              | MEDIUM        | 1. Check application server clocks for drift; 2. Sync with NTP; 3. Manually adjust affected customer invoices; 4. Implement real-time event reporting                                                          |
| Test mode data in production                       | LOW           | 1. Identify test mode objects (IDs start with `test_` prefix); 2. Delete test mode subscriptions; 3. Notify affected users to re-subscribe; 4. Separate test and live webhook endpoints                        |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall                                       | Prevention Phase                | Verification                                                                             |
| --------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| Webhook event ordering race conditions        | Phase 1: Webhook Infrastructure | Test: Send events out of order; verify later events discarded                            |
| Missing webhook idempotency                   | Phase 1: Webhook Infrastructure | Test: Send same event 3 times; verify processed once                                     |
| Subscription status doesn't guarantee payment | Phase 2: Access Control         | Test: Create active subscription with unpaid invoice; verify access denied               |
| Trial period billing cycle reset              | Phase 3: Trial Implementation   | Test: Add trial to existing subscription; verify billing date unchanged or error thrown  |
| Invoice finalization delays                   | Phase 1: Webhook Infrastructure | Test: Slow webhook handler; verify 200 returned before processing                        |
| 23-hour payment window expiration             | Phase 4: Payment Flow           | Test: Create subscription, don't complete payment; verify recovery flow after expiration |
| Proration masks unpaid invoices               | Phase 5: Plan Management        | Test: Unpaid invoice + plan change; verify change blocked                                |
| Missing payment method before trial end       | Phase 3: Trial Implementation   | Test: Trial ending without payment method; verify email sent 3 days before               |
| Webhook signature verification skipped        | Phase 1: Webhook Infrastructure | Test: Send unsigned webhook; verify rejected with 400                                    |
| Usage-based billing timestamp constraints     | Phase 6: Usage Tracking         | Test: Send event with timestamp 36 days ago; verify error handling                       |

## Sources

**HIGH CONFIDENCE (Official Stripe Documentation):**

- [Stripe Webhooks for Subscriptions](https://docs.stripe.com/billing/subscriptions/webhooks) - Invoice finalization delays, webhook requirements
- [Stripe Subscription Overview](https://docs.stripe.com/billing/subscriptions/overview) - Payment behavior, 23-hour window, asynchronous payment methods
- [Stripe Trial Periods](https://docs.stripe.com/billing/subscriptions/trials) - Trial end handling, payment method requirements
- [Stripe Prorations](https://docs.stripe.com/billing/subscriptions/prorations) - Proration behavior, credit handling
- [Stripe Idempotent Requests](https://docs.stripe.com/api/idempotent_requests) - Idempotency key usage
- [Stripe Rate Limits](https://docs.stripe.com/rate-limits) - API rate limiting thresholds
- [Stripe Usage-Based Billing](https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage) - Usage timestamp constraints

**MEDIUM CONFIDENCE (Technical Articles & Community Wisdom):**

- [Stripe Webhooks: Solving Race Conditions](https://www.pedroalonso.net/blog/stripe-webhooks-solving-race-conditions/) - Event ordering issues, timestamp-based deduplication
- [The Race Condition You're Probably Shipping Right Now](https://dev.to/belazy/the-race-condition-youre-probably-shipping-right-now-with-stripe-webhooks-mj4) - Webhook race condition patterns
- [Handling Payment Webhooks Reliably](https://medium.com/@sohail_saifii/handling-payment-webhooks-reliably-idempotency-retries-validation-69b762720bf5) - Idempotency implementation strategies
- [Hookdeck: Implement Webhook Idempotency](https://hookdeck.com/webhooks/guides/implement-webhook-idempotency) - Unique constraints, event ID tracking
- [MagicBell: Stripe Webhooks Complete Guide](https://www.magicbell.com/blog/stripe-webhooks-guide) - Signature verification, webhook security
- [Subscription Business Model Pitfalls](https://www.shoutmecrunch.com/subscription-business-model-guide/) - Subscription model common failures
- [Stripe Billing Guide - FlyCode](https://www.flycode.com/blog/stripe-guide-manage-stripe-billing-lifecycle-and-reporting) - Subscription status vs. invoice status issues
- [Mastering Stripe Subscription Upgrades Part 1](https://engineeringjournal.substack.com/p/mastering-stripe-subscription-upgrades) - Proration best practices
- [Orb: Stripe Limitations for Usage-Based Billing](https://www.withorb.com/blog/stripe-limitations-for-usage-based-billing) - Usage-based billing architectural constraints
- [How Stripe Does Rate Limiting](https://blog.quastor.org/p/stripe-rate-limiting) - Token bucket algorithm, rate limit thresholds
- [Stripe Testing Best Practices](https://docs.stripe.com/billing/testing) - Test mode vs. production mode differences
- [What Subscription Businesses Need to Know About Sales Tax](https://stripe.com/resources/more/what-subscription-businesses-need-to-know-about-sales-tax) - Tax compliance for subscriptions
- [VAT-Exempt vs. Zero-Rated VAT](https://stripe.com/resources/more/vat-exempt-vs-zero-rated-vat) - Tax classification mistakes

---

_Pitfalls research for: SaaS Subscription Billing (Stripe + Node.js + MongoDB)_
_Researched: 2026-02-08_
