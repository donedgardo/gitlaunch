---
status: complete
phase: 04-trial-payment-lifecycle
source: [04-01-SUMMARY.md, 04-02-SUMMARY.md, 04-03-SUMMARY.md, 04-04-SUMMARY.md]
started: 2026-02-21T00:00:00Z
updated: 2026-02-21T00:00:00Z
---

## Current Test

number: 6
name: Subscribed users don't see trial countdown
expected: |
After subscribing via Stripe Checkout (upgradeToPlan), the trial countdown banner disappears. The trialEndsAt field is cleared. Dashboard shows normal state.
awaiting: user response

## Tests

### 1. Trial starts on paid plan selection

expected: In onboarding, select Pro (or Team) plan. After selection, account should have a 14-day trial active. No credit card is required. Dashboard should show trial countdown.
result: PASS

### 2. One trial per GitHub user

expected: If the same GitHub user creates a second account and selects a paid plan, the trial should NOT start (already used). The plan is still selected, but no 14-day trial period is granted.
result: SKIPPED — requires second GitHub account; covered by unit tests (7 tests in trialRegistryRepository.test.ts)

### 3. Trial countdown banner on dashboard

expected: When logged in with an active trial, dashboard shows a yellow warning banner at the top: "Trial: X days remaining. Subscribe to keep your plan." with a link to /settings/billing.
result: PASS

### 4. Trial expiry auto-downgrade

expected: When a trial expires (trialEndsAt is in the past) and user has no Stripe subscription, loading the dashboard auto-downgrades the account to Free plan. The trial countdown banner disappears.
result: PASS

### 5. Read-only banner after downgrade

expected: If an account is downgraded to Free but has more resources than Free limits allow (e.g., 5 repos when limit is 3), dashboard shows a red banner: "Your account exceeds Free plan limits. Resources are read-only. Upgrade to restore full access." with link to /settings/billing.
result: PASS

### 6. Subscribed users don't see trial countdown

expected: After subscribing via Stripe Checkout (upgradeToPlan), the trial countdown banner disappears. The trialEndsAt field is cleared. Dashboard shows normal state.
result: PASS

### 7. Payment failure grace period warning

expected: When account has a payment failure (paymentFailedAt set), dashboard shows a red danger banner: "Payment failed. Please update your payment method within X days to avoid service interruption." with link to /settings/billing. User retains full access during 7-day grace period.
result: PASS

### 8. Billing settings payment failure warning

expected: When account has a payment failure, /settings/billing page shows a payment failure warning section with "Update Payment Method" button linking to Stripe Customer Portal and grace period countdown.
result: PASS

### 9. Grace period expiry restricts access

expected: After the 7-day grace period expires (paymentFailedAt more than 7 days ago), the account becomes read-only. Resources are visible but mutations (create, deploy, modify) are blocked.
result: PASS

### 10. Banner priority ordering

expected: When multiple warnings are active simultaneously (e.g., payment failure + trial + over-limit), the most critical banner shows first: payment failure (red) > trial countdown (yellow) > read-only (red).
result: PASS

## Summary

total: 10
passed: 9
issues: 0
pending: 1
skipped: 1
skipped: 0

## Gaps

All gaps addressed during UAT:

1. ~~Deploy/redeploy not blocked when read-only~~ — FIXED: Added read-only check to PATCH deploy endpoint
2. Session middleware ordering — FIXED: Registered before billing routes
3. Billing page missing layout — FIXED: Added layout wrapper
4. Stripe URLs relative — FIXED: Using PUBLIC_URL for absolute URLs
5. HTMX buttons not redirecting to Stripe — FIXED: Changed to regular form POST with server redirect
6. Billing page missing trial status — FIXED: Shows trial days remaining + Subscribe Now button
7. Navigation missing on billing page — FIXED: Pass services data, added Billing link to nav
8. Payment failure banner not showing when grace expired — FIXED: Handle gracePeriodDaysRemaining=0
9. Dark mode text contrast on payment failure — FIXED: White/gray text on dark backgrounds
