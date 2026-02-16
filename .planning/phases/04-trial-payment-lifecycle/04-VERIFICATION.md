---
phase: 04-trial-payment-lifecycle
verified: 2026-02-16T05:43:34Z
status: gaps_found
score: 29/30 must-haves verified
gaps:
  - truth: "TrialRegistry collection enforces uniqueness via MongoDB unique index on githubId (Plan 04-01)"
    status: partial
    reason: "ensureIndexes exists but NOT called in src/index.ts startup - index may not exist in production"
    artifacts:
      - path: "src/repositories/trialRegistryRepository.ts"
        issue: "ensureIndexes method exists (line 39-41) but missing from src/index.ts startup sequence"
    missing:
      - "Add await trialRegistryRepository.ensureIndexes() in src/index.ts start() function (after line 83)"
---

# Phase 4: Trial & Payment Lifecycle Verification Report

**Phase Goal:** Users get 14-day no-CC trials on paid plans and system handles trial expiry and payment failures gracefully

**Verified:** 2026-02-16T05:43:34Z

**Status:** gaps_found

**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #                     | Truth                                                                                 | Status     | Evidence                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| **Plan 04-01 Truths** |
| 1                     | Selecting a paid plan starts a 14-day trial on the account                            | ✓ VERIFIED | TrialService.startTrial sets trialEndsAt to now + 14 days (line 48-50), wired in onboarding (line 103)              |
| 2                     | A GitHub user can only claim one trial across all accounts                            | ⚠️ PARTIAL | TrialRegistryRepository has unique index logic BUT ensureIndexes NOT called in src/index.ts startup                 |
| 3                     | Duplicate trial claim attempt returns false (not an error)                            | ✓ VERIFIED | claimTrial catches error.code === 11000, returns false (line 27-28)                                                 |
| 4                     | Account stores trialEndsAt field set to 14 days from claim time                       | ✓ VERIFIED | Account type includes trialEndsAt: Date \| null (line 26), set in startTrial (line 54)                              |
| 5                     | TrialRegistry collection enforces uniqueness via MongoDB unique index on githubId     | ⚠️ PARTIAL | ensureIndexes method exists (line 39-41) but NOT called in src/index.ts - may not be created in production          |
| **Plan 04-02 Truths** |
| 6                     | Selecting a paid plan in onboarding starts a trial via TrialService                   | ✓ VERIFIED | onboarding/index.ts calls trialService.startTrial for Pro/Team plans (line 103)                                     |
| 7                     | Dashboard shows trial countdown (days remaining) when account is on trial             | ✓ VERIFIED | dashboard.hbs shows banner when trialDaysRemaining > 0 (line 23-34)                                                 |
| 8                     | Account auto-downgrades to Free when trial expires (checked on dashboard load)        | ✓ VERIFIED | checkAndHandleTrialExpiry called on dashboard load (line 68, 132), downgrades if expired (line 107-109)             |
| 9                     | Over-limit resources are visible but marked read-only after downgrade                 | ✓ VERIFIED | dashboard.hbs shows read-only banner when isReadOnly true (line 36-49)                                              |
| 10                    | PlanEnforcementService computes isReadOnly from current usage vs plan limits          | ✓ VERIFIED | getAccountState computes isReadOnly = current > limit (line 299-302)                                                |
| 11                    | Trial state clears when user subscribes via Stripe (upgradeToPlan clears trialEndsAt) | ✓ VERIFIED | upgradeToPlan sets trialEndsAt: null (line 147)                                                                     |
| **Plan 04-03 Truths** |
| 12                    | Payment failure webhook sets paymentFailedAt on account                               | ✓ VERIFIED | AccountRepository.setPaymentFailed exists (line 188-198)                                                            |
| 13                    | Account in grace period (within 7 days of paymentFailedAt) retains full access        | ✓ VERIFIED | isInGracePeriod checks paymentFailedAt + 7 days > now (line 255-264), isReadOnly false when in grace (line 299-302) |
| 14                    | Account past grace period has resources restricted (read-only enforcement)            | ✓ VERIFIED | isReadOnly true when paymentFailed && !inGracePeriod (line 302)                                                     |
| 15                    | Dashboard shows grace period warning with days remaining when payment has failed      | ✓ VERIFIED | dashboard.hbs shows red banner with gracePeriodDaysRemaining (line 8-21)                                            |
| 16                    | Payment success webhook clears paymentFailedAt and restores access                    | ✓ VERIFIED | AccountRepository.clearPaymentFailed exists (line 200-210)                                                          |
| 17                    | Billing settings page shows payment failure warning with link to Stripe portal        | ✓ VERIFIED | billing.hbs shows payment failure section with CTA (line 14-38)                                                     |

**Score:** 15/17 truths verified (2 partial due to same root cause: missing ensureIndexes call)

### Required Artifacts

| Artifact                                       | Expected                                                                   | Status     | Details                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------ |
| **Plan 04-01 Artifacts**                       |
| src/repositories/trialRegistryRepository.ts    | TrialRegistry collection with unique githubId index and claimTrial method  | ✓ VERIFIED | 42 lines, exports TrialRegistryRepository + TrialRegistryEntry, no stubs |
| src/services/billing/trialService.ts           | TrialService with startTrial method coordinating registry + account update | ✓ VERIFIED | 111 lines, exports TrialService + types, no stubs, 14/14 tests pass      |
| src/repositories/accountRepository.ts          | Account type extended with trialEndsAt field                               | ✓ VERIFIED | trialEndsAt: Date \| null on line 26, setTrialEndsAt method line 212-222 |
| **Plan 04-02 Artifacts**                       |
| src/server/routes/onboarding/index.ts          | Plan selection wired to TrialService.startTrial for paid plans             | ✓ VERIFIED | trialService.startTrial called line 103 for Pro/Team plans               |
| src/server/dashboard/index.ts                  | Trial expiry check on dashboard load with auto-downgrade                   | ✓ VERIFIED | checkAndHandleTrialExpiry called line 68, 132 before rendering           |
| src/services/billing/planEnforcementService.ts | getAccountState method computing isReadOnly from usage vs limits           | ✓ VERIFIED | 325 lines, getAccountState line 283-324, 43/43 tests pass                |
| src/templates/dashboard.hbs                    | Trial countdown banner showing days remaining                              | ✓ VERIFIED | Banner line 23-34 with trialDaysRemaining, yellow warning style          |
| **Plan 04-03 Artifacts**                       |
| src/services/billing/planEnforcementService.ts | isInGracePeriod and getGracePeriodDaysRemaining methods                    | ✓ VERIFIED | GRACE_PERIOD_DAYS constant line 53, methods line 255-281                 |
| src/templates/dashboard.hbs                    | Grace period warning banner                                                | ✓ VERIFIED | Red banner line 8-21 with gracePeriodDaysRemaining, highest priority     |
| src/templates/settings/billing.hbs             | Payment failure warning with action link                                   | ✓ VERIFIED | Payment failure section line 14-38 with "Update Payment Method" CTA      |

**All artifacts:** 10/10 verified, all substantive (adequate length, no stubs, proper exports)

### Key Link Verification

| From                                           | To                                             | Via                                                   | Status  | Details                                                                                       |
| ---------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------- |
| **Plan 04-01 Links**                           |
| src/services/billing/trialService.ts           | src/repositories/trialRegistryRepository.ts    | claimTrial for atomic duplicate prevention            | ✓ WIRED | claimTrial called line 38-41, result used line 43-45                                          |
| src/services/billing/trialService.ts           | src/repositories/accountRepository.ts          | setting trialEndsAt on account after successful claim | ✓ WIRED | accountRepo.setTrialEndsAt called line 54 with calculated date                                |
| **Plan 04-02 Links**                           |
| src/server/routes/onboarding/index.ts          | src/services/billing/trialService.ts           | startTrial called on paid plan selection              | ✓ WIRED | trialService.startTrial line 103, result checked line 111                                     |
| src/server/dashboard/index.ts                  | src/services/billing/trialService.ts           | checkAndHandleTrialExpiry called on dashboard load    | ✓ WIRED | Called line 68, 132 before rendering templates                                                |
| src/server/dashboard/index.ts                  | src/services/billing/planEnforcementService.ts | getAccountState for read-only state in template       | ✓ WIRED | Called line 72, 136, passed to template line 86-89, 210-213                                   |
| **Plan 04-03 Links**                           |
| src/services/billing/planEnforcementService.ts | src/repositories/accountRepository.ts          | account.paymentFailedAt for grace period computation  | ✓ WIRED | isInGracePeriod checks account.paymentFailedAt line 256, getAccountState uses it line 292-294 |
| src/server/dashboard/index.ts                  | src/services/billing/planEnforcementService.ts | getAccountState includes grace period info            | ✓ WIRED | accountState passed to template includes gracePeriodDaysRemaining, paymentFailed              |

**All key links:** 7/7 verified and wired correctly

### Requirements Coverage

| Requirement                                  | Status      | Blocking Issue                                                      |
| -------------------------------------------- | ----------- | ------------------------------------------------------------------- |
| TRIL-01: 14-day trial on paid plan selection | ✓ SATISFIED | All truths verified                                                 |
| TRIL-02: Trial countdown in dashboard        | ✓ SATISFIED | All truths verified                                                 |
| TRIL-03: Auto-downgrade on trial expiry      | ✓ SATISFIED | All truths verified                                                 |
| TRIL-04: One trial per GitHub user           | ⚠️ PARTIAL  | ensureIndexes not called in startup - may not enforce in production |
| PYMT-01: Payment failure grace period        | ✓ SATISFIED | All truths verified                                                 |
| PYMT-02: Grace period UI warnings            | ✓ SATISFIED | All truths verified                                                 |

**Coverage:** 5/6 requirements fully satisfied, 1 partial

### Anti-Patterns Found

No critical anti-patterns detected. All files are substantive with no TODO/FIXME/placeholder comments.

**Checked files:**

- src/repositories/trialRegistryRepository.ts (42 lines) - Clean
- src/services/billing/trialService.ts (111 lines) - Clean
- src/services/billing/planEnforcementService.ts (325 lines) - Clean
- src/server/routes/onboarding/index.ts - Clean
- src/server/dashboard/index.ts - Clean
- src/templates/dashboard.hbs - Clean
- src/templates/settings/billing.hbs - Clean

### Human Verification Required

#### 1. Trial Countdown Visual Display

**Test:** Create a new account, select Pro plan in onboarding, navigate to dashboard
**Expected:** Yellow banner shows "Trial: 14 days remaining. Subscribe to keep your plan." with link to /settings/billing
**Why human:** Visual appearance, banner styling, and user flow completion require browser testing

#### 2. Trial Expiry Auto-Downgrade Flow

**Test:**

1. Create account with trial ending in past (manually set trialEndsAt in MongoDB)
2. Load dashboard
3. Verify account downgraded to Free plan
4. If account has 5+ repos/services, verify read-only banner appears

**Expected:**

- Trial banner disappears
- Red read-only banner shows "Your account exceeds Free plan limits. Resources are read-only."
- User can view but not add resources

**Why human:** Time-dependent behavior and multi-step flow validation

#### 3. Payment Failure Grace Period Warning

**Test:**

1. Create Pro account with active subscription
2. Trigger payment failure (via Stripe test webhook or manual paymentFailedAt set)
3. Load dashboard immediately
4. Wait 5 days (or manually advance paymentFailedAt)
5. Load dashboard again

**Expected:**

- Immediately: Red banner shows "Payment failed. Please update your payment method within 7 days..."
- After 5 days: Red banner shows "...within 2 days..."
- After 7+ days: Banner changes to read-only warning if user hasn't paid

**Why human:** Time-based state transitions, banner priority, external Stripe integration

#### 4. Banner Priority Order

**Test:** Create scenarios with multiple warnings active:

- Account with trial + payment failure
- Account with trial + over limits
- Account with payment failure + over limits

**Expected:** Banner priority order: payment failure > trial countdown > read-only
**Why human:** Visual verification of UI priority logic

#### 5. Billing Settings Payment Failure Section

**Test:**

1. Set account.paymentFailedAt to 3 days ago
2. Navigate to /settings/billing
3. Click "Update Payment Method" button

**Expected:**

- Payment failure warning shows with "3 days remaining before access is restricted"
- Button redirects to Stripe Customer Portal
- Portal allows payment method update

**Why human:** External Stripe portal integration, link verification, real payment flow

### Gaps Summary

**1 gap found blocking full phase completion:**

**Gap: TrialRegistryRepository.ensureIndexes() not called in src/index.ts startup**

**Impact:** CRITICAL - Without calling ensureIndexes() in production startup, the unique index on githubId may not exist. This means the one-trial-per-GitHub-user constraint could fail, allowing users to claim multiple trials by creating multiple accounts.

**Why critical:**

- The claimTrial method relies on MongoDB duplicate key error (code 11000) to detect repeat trials
- If the unique index doesn't exist, insertOne will succeed every time
- Users could abuse trials by creating unlimited accounts with the same GitHub ID

**Evidence:**

- TrialRegistryRepository.ensureIndexes() defined: src/repositories/trialRegistryRepository.ts line 39-41 ✓
- Called in tests: trialRegistryRepository.test.ts line 18, onboarding/index.test.ts line 99 ✓
- Called in src/index.ts startup: NOT FOUND ✗
- Other repos call ensureIndexes in startup: buildRepository (line 81), serviceRepository (line 82), webhookEventRepository (line 83) ✓

**Fix required:**
Add the following line to src/index.ts after line 83:

```typescript
const trialRegistryRepository = new TrialRegistryRepository(database);
await trialRegistryRepository.ensureIndexes();
```

**Verification after fix:**

1. Start server
2. Check MongoDB collection indexes: `db.trialRegistry.getIndexes()`
3. Verify unique index exists on `{ githubId: 1 }`
4. Attempt duplicate trial claim - should return false instead of succeeding

---

_Verified: 2026-02-16T05:43:34Z_
_Verifier: Claude (gsd-verifier)_
