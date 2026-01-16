# GitLaunch Multi-Tenant SaaS Transformation Plan

## Overview

Transform GitLaunch from a single-tenant deployment tool into a multi-tenant SaaS platform with:

- **Free tier**: 1 public GitHub repository
- **Paid tier**: 5 repositories, 5 users, private repos allowed
- GitHub App integration (replacing PAT)
- Stripe billing
- GitHub OAuth (replacing Google OAuth)
- Per-account API keys

---

## Implementation Progress

| Phase       | Status      | Tests    | Description                                   |
| ----------- | ----------- | -------- | --------------------------------------------- |
| **Phase 1** | ✅ Complete | 46 tests | Data models, GitHub OAuth, session management |
| **Phase 2** | ✅ Complete | 31 tests | GitHub App integration                        |
| **Phase 3** | ✅ Complete | 57 tests | API Keys & Multi-Account                      |
| **Phase 4** | ⏳ Pending  | -        | Stripe Billing                                |
| **Phase 5** | ⏳ Pending  | -        | Landing Page & Onboarding                     |
| **Phase 6** | ⏳ Pending  | -        | Migration & Cleanup                           |

### Phase 1 Completed Files

| File                                       | Tests | Description                              |
| ------------------------------------------ | ----- | ---------------------------------------- |
| `src/repositories/accountRepository.ts`    | 7     | Account CRUD with free plan defaults     |
| `src/repositories/userRepository.ts`       | 6     | User CRUD with GitHub ID lookup          |
| `src/repositories/membershipRepository.ts` | 7     | User-Account relationships               |
| `src/services/auth/sessionService.ts`      | 7     | JWT session creation/validation          |
| `src/services/auth/githubOAuthService.ts`  | 7     | GitHub OAuth with injectable HTTP client |
| `src/server/middleware/sessionAuth.ts`     | 6     | Session extraction from cookie/header    |
| `src/server/routes/auth/github.ts`         | 6     | OAuth routes with auto-account creation  |

**Total Phase 1 Tests: 46** (all passing as of January 2026)

### Phase 2 Completed Files

| File                                              | Tests | Description                              |
| ------------------------------------------------- | ----- | ---------------------------------------- |
| `src/repositories/repositoryRepository.ts`        | 4     | Repository CRUD with tenant isolation    |
| `src/services/repository/repositoryService.ts`    | 3     | Plan limit enforcement (repos, private)  |
| `src/services/github/installationTokenService.ts` | 4     | Token caching with expiry handling       |
| `src/services/github/githubAppClient.ts`          | 4     | JWT generation for GitHub App auth       |
| `src/services/github/githubDispatchService.ts`    | 4     | Multi-tenant workflow dispatch           |
| `src/services/github/githubAppService.ts`         | 6     | Installation linking and repo listing    |
| `src/services/github/githubApiClient.ts`          | 3     | GitHub API client for installation repos |
| `src/server/routes/github/installation.ts`        | 3     | Installation callback route              |

**Total Phase 2 Tests: 31** (all passing as of January 2026)

### Phase 3 Completed Files

| File                                               | Tests | Description                            |
| -------------------------------------------------- | ----- | -------------------------------------- |
| `src/repositories/apiKeyRepository.ts`             | 6     | API key CRUD with prefix lookup        |
| `src/repositories/invitationRepository.ts`         | 6     | Invitation CRUD with token lookup      |
| `src/services/apiKey/apiKeyService.ts`             | 10    | Key generation (bcrypt) and validation |
| `src/services/invitation/invitationService.ts`     | 7     | Invitation flow with expiry handling   |
| `src/services/account/accountMembershipService.ts` | 7     | User-account relationships and access  |
| `src/services/account/teamManagementService.ts`    | 11    | Role-based team member management      |
| `src/server/middleware/apiKeyAuth.ts`              | 5     | API key authentication middleware      |
| `src/server/middleware/accountContext.ts`          | 5     | Account context resolution middleware  |

**Total Phase 3 Tests: 57** (all passing as of January 2026)

**Total Tests: 198** (Phase 1 + Phase 2 + Phase 3 + existing tests)

---

## TDD Methodology: Red-Green-Refactor

All implementation follows strict TDD principles (Kent Beck style). See `CLAUDE.md` for detailed TDD workflow instructions.

### The Cycle

```
1. RED    -> Write a failing test that defines desired behavior
2. GREEN  -> Write minimal code to make the test pass
3. BLUE   -> Refactor while keeping tests green
```

### TDD Rules

1. **No production code without a failing test first**
2. **Write only enough test to fail** (compilation failures count)
3. **Write only enough code to pass** the failing test
4. **Refactor immediately** when you see duplication or smell
5. **Small increments** - one behavior at a time
6. **SOLID principles** guide refactoring decisions
7. **Test BEHAVIOR, not implementation** - tests describe WHAT, not HOW

---

## TDD Implementation Flow Per Feature

For each feature, follow this behavior-focused pattern:

```
Example: Creating an account

1. RED - Write BEHAVIOR test (describe WHAT, not HOW):
   describe('AccountRepository', () => {
     describe('create', () => {
       it('should return account with generated ID and default free plan', async () => {
         // Given: valid account details
         const input = { name: 'My Org', slug: 'my-org' };

         // When: I create the account
         const account = await repo.create(input);

         // Then: I get back an account ready to use
         expect(account.name).toBe('My Org');
         expect(account.slug).toBe('my-org');
         expect(account._id).toBeDefined();      // Has ID
         expect(account.plan).toBe('free');       // Default plan
         expect(account.planLimits.maxRepositories).toBe(1);  // Free limits
       });
     });
   });

   // NOTE: We DO NOT test:
   // - That insertOne was called (implementation detail)
   // - That createdAt was set (unless observable in behavior)
   // - Internal structure of MongoDB documents

2. GREEN - Minimal implementation to pass:
   class AccountRepository {
     async create(input: CreateAccountInput): Promise<Account> {
       const account = {
         ...input,
         plan: 'free' as const,
         planLimits: { maxRepositories: 1, maxUsers: 1, publicReposOnly: true },
         // ... other fields
       };
       const result = await this.collection.insertOne(account);
       return { _id: result.insertedId, ...account };
     }
   }

3. BLUE - Refactor (keeping tests green):
   - Extract free plan defaults to constant
   - Improve type safety with branded types
   - Add validation if needed (with new behavior tests first!)
```

---

## Phase 1: Data Models & GitHub OAuth

### New MongoDB Collections

**Account** (tenant/organization)

```typescript
{
  _id: ObjectId,
  name: string,
  slug: string,                    // unique, URL-friendly
  stripeCustomerId: string | null,
  stripeSubscriptionId: string | null,
  plan: 'free' | 'paid',
  planLimits: {
    maxRepositories: number,       // free: 1, paid: 5
    maxUsers: number,              // free: 1, paid: 5
    publicReposOnly: boolean       // free: true, paid: false
  },
  githubInstallationId: number | null,
  githubInstallationAccessToken: string | null,
  githubInstallationTokenExpiresAt: Date | null,
  createdAt: Date,
  updatedAt: Date
}
```

**User** (persisted, linked to GitHub)

```typescript
{
  _id: ObjectId,
  githubId: number,
  githubLogin: string,
  email: string | null,
  name: string | null,
  avatarUrl: string | null,
  githubAccessToken: string,       // encrypted
  createdAt: Date,
  lastLoginAt: Date
}
```

**AccountMembership** (user-account relationship)

```typescript
{
  _id: ObjectId,
  userId: ObjectId,
  accountId: ObjectId,
  role: 'owner' | 'admin' | 'member',
  createdAt: Date
}
```

**Repository** (replaces hardcoded SERVICES env var)

```typescript
{
  _id: ObjectId,
  accountId: ObjectId,
  githubRepoId: number,
  githubFullName: string,          // "org/repo-name"
  githubOwner: string,
  githubRepoName: string,
  isPrivate: boolean,
  environments: [
    { name: 'staging', displayName: 'Staging', order: 0 },
    { name: 'prod', displayName: 'Production', order: 1 }
  ],
  workflowFile: string,            // default: "deploy.yml"
  eventType: string,               // default: "deployment"
  isActive: boolean,
  createdAt: Date
}
```

**ApiKey** (per-account API keys)

```typescript
{
  _id: ObjectId,
  accountId: ObjectId,
  createdByUserId: ObjectId,
  name: string,
  keyPrefix: string,               // "lp_myco_abc" for display
  keyHash: string,                 // bcrypt hash
  scopes: ['builds:read', 'builds:write', 'deployments:write'],
  lastUsedAt: Date | null,
  expiresAt: Date | null,
  isRevoked: boolean,
  createdAt: Date
}
// Key format: lp_{accountSlug}_{32-random-bytes-base64url}
```

**BuildRecord** (updated with tenant isolation)

```typescript
{
  _id: ObjectId,
  accountId: ObjectId,             // NEW
  repositoryId: ObjectId,          // NEW (replaces per-service collections)
  id: string,
  commitSha: string | null,
  branch: string | null,
  deployments: Record<string, DeploymentStatus>,
  deploymentLogs: DeploymentLogRecord[],
  triggeredByUserId: ObjectId | null,
  triggeredByApiKeyId: ObjectId | null,
  createdAt: Date
}
// Single 'builds' collection with index: { accountId, repositoryId, createdAt }
```

### GitHub OAuth Implementation

Replace Google OAuth with GitHub OAuth:

1. **New routes**:

   - `GET /auth/github` - Redirect to GitHub OAuth
   - `GET /auth/github/callback` - Handle OAuth callback

2. **Flow**:

   - User clicks "Login with GitHub"
   - Redirect to `https://github.com/login/oauth/authorize`
   - Exchange code for access token
   - Fetch user info from GitHub API
   - Create/update User record
   - Create default Account on first login
   - Set JWT session cookie

3. **Session management**: JWT in signed HTTP-only cookie (15-min access + 7-day refresh)

### Files to Create

```
src/models/account.ts
src/models/user.ts
src/models/accountMembership.ts
src/models/repository.ts
src/models/apiKey.ts
src/repositories/accountRepository.ts
src/repositories/userRepository.ts
src/repositories/membershipRepository.ts
src/repositories/repositoryRepository.ts
src/repositories/apiKeyRepository.ts
src/services/auth/githubOAuthService.ts
src/services/auth/sessionService.ts
src/server/routes/auth/github.ts
```

### Files to Modify

- `src/server/registerPlugins.ts` - Add GitHub OAuth config
- `src/server/auth/index.ts` - New auth middleware
- `src/index.ts` - Initialize new services

### Phase 1 TDD Task Breakdown

Each task follows RED -> GREEN -> BLUE cycle. **All tests describe BEHAVIOR, not implementation.**

| #    | Behavior Test (RED)                                          | Make it Pass (GREEN)                         | Refactor (BLUE)                             |
| ---- | ------------------------------------------------------------ | -------------------------------------------- | ------------------------------------------- |
| 1.1  | Creating an account returns it with ID and default free plan | Implement `AccountRepository.create()`       | Extract shared types if needed              |
| 1.2  | Finding account by slug returns the matching account         | Implement `findBySlug()`                     | Extract `RepositoryBase` if pattern emerges |
| 1.3  | Finding account by unknown slug returns null                 | Handle not-found case                        | -                                           |
| 1.4  | Creating account with duplicate slug fails with clear error  | Add uniqueness check                         | -                                           |
| 1.5  | Creating user with GitHub ID returns user with profile data  | Implement `UserRepository.create()`          | -                                           |
| 1.6  | Finding existing user by GitHub ID returns that user         | Implement `findByGitHubId()`                 | -                                           |
| 1.7  | Find-or-create returns existing user when GitHub ID exists   | Implement upsert behavior                    | -                                           |
| 1.8  | Adding user to account creates membership with role          | Implement `MembershipRepository.create()`    | -                                           |
| 1.9  | Getting user's accounts returns all their memberships        | Implement `findByUserId()`                   | -                                           |
| 1.10 | Exchanging valid OAuth code returns access token             | Implement OAuth token exchange (fake GitHub) | Extract HTTP client                         |
| 1.11 | Fetching user info with token returns GitHub profile         | Implement user info fetch (fake GitHub)      | -                                           |
| 1.12 | Creating session returns token that can be validated         | Implement `SessionService`                   | -                                           |
| 1.13 | Validating expired session token returns null                | Add expiry handling                          | -                                           |
| 1.14 | Request with valid session cookie has user attached          | Implement auth middleware                    | -                                           |
| 1.15 | Request without session is redirected to login               | Add redirect behavior                        | -                                           |
| 1.16 | Visiting `/auth/github` redirects to GitHub OAuth URL        | Create OAuth redirect route                  | -                                           |
| 1.17 | OAuth callback with valid code creates user and session      | Handle callback flow                         | -                                           |
| 1.18 | New user gets a default account created automatically        | Auto-create account on first login           | Apply SRP to callback                       |

---

## Phase 2: GitHub App Integration

### GitHub App Setup

**Required permissions**:

- Repository > Contents: Read
- Repository > Actions: Write (for workflow dispatch)
- Repository > Metadata: Read
- Account > Email addresses: Read

### Installation Flow

1. User clicks "Connect GitHub" in account settings
2. Redirect to `https://github.com/apps/{app-name}/installations/new`
3. User selects org/repos and installs
4. GitHub redirects to `/github/installation/callback`
5. Store `installation_id` in Account record

### Files to Create

```
src/services/github/installationTokenService.ts
src/services/github/githubAppService.ts
src/server/routes/github/installation.ts
src/templates/settings/repositories.hbs
```

### Files to Modify

- `src/services/service/githubDispatchService.ts` - Use installation tokens
- `src/services/createServices.ts` - Load from DB, not env

### New Environment Variables

```bash
GITHUB_APP_ID=...
GITHUB_APP_CLIENT_ID=...
GITHUB_APP_CLIENT_SECRET=...
GITHUB_APP_PRIVATE_KEY=...        # Base64 encoded PEM
GITHUB_APP_WEBHOOK_SECRET=...
```

### Phase 2 TDD Task Breakdown

**All tests describe BEHAVIOR, not implementation.**

| #    | Behavior Test (RED)                                         | Make it Pass (GREEN)                      | Refactor (BLUE)         |
| ---- | ----------------------------------------------------------- | ----------------------------------------- | ----------------------- |
| 2.1  | Adding a repository to account returns it with environments | Implement `RepositoryRepository.create()` | -                       |
| 2.2  | Getting repos for account returns only that account's repos | Implement `findByAccountId()`             | -                       |
| 2.3  | Account can have max repos based on plan limit              | Enforce plan limit                        | -                       |
| 2.4  | Getting installation token for account returns valid token  | Implement token service (fake GitHub App) | -                       |
| 2.5  | Getting token twice within expiry returns same token        | Add caching behavior                      | Extract cache interface |
| 2.6  | Getting token after expiry fetches fresh token              | Handle expiry refresh                     | -                       |
| 2.7  | Dispatching deployment triggers workflow on GitHub          | Implement dispatch (fake GitHub)          | -                       |
| 2.8  | Dispatch uses account's installation, not global PAT        | Refactor dispatch service                 | -                       |
| 2.9  | Installing GitHub App links installation to account         | Implement callback                        | -                       |
| 2.10 | Listing installed repos returns repos user has access to    | Implement repo listing (fake GitHub)      | -                       |
| 2.11 | Repository settings page shows connectable repos            | Create settings UI                        | -                       |

---

## Phase 3: API Keys & Multi-Account

### API Key System

**Key generation**:

- Format: `lp_{accountSlug}_{32-random-bytes-base64url}`
- Store bcrypt hash (key shown once, cannot be retrieved)
- Scopes: `builds:read`, `builds:write`, `deployments:write`

### Multi-Account Support

- Users can belong to multiple accounts with different roles
- Account selector in dashboard header
- Account context stored in session/URL
- All queries filtered by `accountId`

### Role-Based Access

| Role   | Permissions                          |
| ------ | ------------------------------------ |
| Owner  | Full access, billing, delete account |
| Admin  | Manage repos, users, API keys        |
| Member | View dashboard, trigger deployments  |

### Files to Create

```
src/services/apiKey/apiKeyService.ts
src/server/middleware/apiKeyAuth.ts
src/server/middleware/accountContext.ts
src/server/routes/settings/apiKeys.ts
src/server/routes/settings/team.ts
src/templates/settings/apiKeys.hbs
src/templates/settings/team.hbs
```

### Phase 3 TDD Task Breakdown

**All tests describe BEHAVIOR, not implementation.**

| #    | Behavior Test (RED)                                       | Make it Pass (GREEN)                 | Refactor (BLUE)        |
| ---- | --------------------------------------------------------- | ------------------------------------ | ---------------------- |
| 3.1  | Generating API key returns key starting with `lp_` prefix | Implement `ApiKeyService.generate()` | -                      |
| 3.2  | Generated key can be used to authenticate requests        | Implement validation                 | -                      |
| 3.3  | Invalid/random key is rejected with 401                   | Add rejection behavior               | -                      |
| 3.4  | Revoked key is rejected even if format is valid           | Add revoked check                    | Consolidate validation |
| 3.5  | Expired key is rejected with clear message                | Add expiry check                     | -                      |
| 3.6  | Revoking key prevents future authentication               | Implement revoke                     | -                      |
| 3.7  | Request with valid API key can create builds              | Integration test                     | -                      |
| 3.8  | Request with valid API key can update deployment status   | Integration test                     | -                      |
| 3.9  | Inviting user to account sends them invitation            | Implement invite flow                | -                      |
| 3.10 | Accepting invitation adds user to account                 | Implement accept                     | -                      |
| 3.11 | User can see all accounts they belong to                  | Implement account listing            | -                      |
| 3.12 | User can switch between their accounts                    | Implement account switching          | -                      |
| 3.13 | Dashboard shows only current account's data               | Add tenant scoping                   | Extract tenant filter  |
| 3.14 | User cannot access other account's data                   | Security test                        | -                      |
| 3.15 | Account admins can manage team members                    | Role-based access                    | -                      |

---

## Phase 4: Stripe Billing

### Stripe Setup

**Products**:

- GitLaunch Free ($0/month)
- GitLaunch Pro ($X/month)

### Checkout Flow

1. User clicks "Upgrade" in billing settings
2. Create Stripe Checkout Session
3. Redirect to Stripe-hosted checkout
4. Stripe redirects back on success/cancel
5. Webhook updates account plan

### Webhook Events

- `checkout.session.completed` - Initial subscription
- `customer.subscription.updated` - Plan changes
- `customer.subscription.deleted` - Cancellation
- `invoice.payment_failed` - Payment issues

### Files to Create

```
src/services/billing/stripeService.ts
src/services/billing/planEnforcementService.ts
src/server/routes/settings/billing.ts
src/server/routes/webhooks/stripe.ts
src/templates/settings/billing.hbs
```

### New Environment Variables

```bash
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
STRIPE_PRICE_FREE_MONTHLY=price_...
STRIPE_PRICE_PRO_MONTHLY=price_...
```

### Phase 4 TDD Task Breakdown

**All tests describe BEHAVIOR, not implementation.**

| #    | Behavior Test (RED)                                  | Make it Pass (GREEN)             | Refactor (BLUE)            |
| ---- | ---------------------------------------------------- | -------------------------------- | -------------------------- |
| 4.1  | Starting checkout returns URL to Stripe payment page | Implement checkout (fake Stripe) | -                          |
| 4.2  | Completing payment upgrades account to paid plan     | Handle webhook event             | -                          |
| 4.3  | Upgraded account has increased repo/user limits      | Update plan limits               | -                          |
| 4.4  | Canceling subscription downgrades to free plan       | Handle cancellation webhook      | Extract webhook handlers   |
| 4.5  | Failed payment triggers grace period notification    | Handle payment failure           | -                          |
| 4.6  | Free account cannot add more than 1 repository       | Enforce repo limit               | -                          |
| 4.7  | Free account cannot connect private repositories     | Enforce public-only              | -                          |
| 4.8  | Free account cannot add more than 1 user             | Enforce user limit               | Extract common limit check |
| 4.9  | Paid account can add up to 5 repositories            | Allow within limits              | -                          |
| 4.10 | Paid account can connect private repositories        | Remove restriction               | -                          |
| 4.11 | Attempting to exceed limit shows upgrade prompt      | UX for limit reached             | -                          |
| 4.12 | Billing page shows current plan and usage            | Create billing UI                | -                          |
| 4.13 | Manage subscription opens Stripe billing portal      | Implement portal link            | -                          |
| 4.14 | Downgrading with excess repos prompts user to remove | Handle over-limit state          | -                          |

---

## Phase 5: Landing Page & Onboarding

### Static Landing Page

Create `public/` static files:

- `index.html` - Landing page with:
  - Hero section with value proposition
  - Feature highlights
  - Pricing table (Free vs Pro)
  - CTA buttons
- `css/landing.css` - Landing page styles

### Onboarding Flow

1. Sign up with GitHub
2. Create account (name, slug)
3. Install GitHub App
4. Select repositories to track
5. Configure environments
6. Generate first API key

### Files to Create

```
public/landing/index.html
public/landing/css/styles.css
src/templates/onboarding/welcome.hbs
src/templates/onboarding/install-github.hbs
src/templates/onboarding/select-repos.hbs
```

### Phase 5 TDD Task Breakdown

**All tests describe BEHAVIOR, not implementation.**

| #   | Behavior Test (RED)                                 | Make it Pass (GREEN)    | Refactor (BLUE) |
| --- | --------------------------------------------------- | ----------------------- | --------------- |
| 5.1 | Landing page displays value proposition and pricing | Create static HTML      | -               |
| 5.2 | Clicking "Get Started" begins GitHub OAuth flow     | Wire up signup CTA      | -               |
| 5.3 | New user sees onboarding wizard after first login   | Implement redirect      | -               |
| 5.4 | Onboarding prompts user to install GitHub App       | Create install step     | -               |
| 5.5 | After installing, user can select repos to track    | Show repo selection     | -               |
| 5.6 | Selecting repo adds it to user's account            | Connect repo to account | -               |
| 5.7 | Completing onboarding generates first API key       | Auto-generate key       | -               |
| 5.8 | API key is shown once with copy button              | Display key safely      | -               |
| 5.9 | User lands on dashboard after onboarding complete   | Redirect to dashboard   | -               |

---

## Phase 6: Migration & Cleanup

### Data Migration Script

```typescript
// scripts/migrate-to-multitenant.ts
1. Create default account for existing data
2. Create Repository records from SERVICES env var
3. Migrate builds from per-service collections to unified 'builds' collection
4. Output manual steps (install GitHub App, create users)
```

### Deprecation Removal

- Remove Google OAuth code
- Remove legacy single API key support
- Remove `SERVICES`, `GITHUB_PAT`, `GITHUB_ORG` env vars
- Archive old per-service MongoDB collections

---

## Critical Files Summary

| File                                             | Changes                                            |
| ------------------------------------------------ | -------------------------------------------------- |
| `src/index.ts`                                   | New service initialization, dynamic tenant loading |
| `src/services/createServices.ts`                 | Database-driven instead of env-based               |
| `src/services/service/githubDispatchService.ts`  | Use installation tokens                            |
| `src/server/auth/index.ts`                       | GitHub OAuth + API key middleware                  |
| `src/services/buildStorage/mongoBuildStorage.ts` | Tenant isolation                                   |
| `src/server/registerPlugins.ts`                  | GitHub OAuth, Stripe webhook config                |
| `src/server/dashboard/index.ts`                  | Account-scoped dashboard                           |
| `src/server/build/index.ts`                      | Account-scoped build routes                        |

---

## Verification Plan

### Phase 1 Verification

- [x] User can log in with GitHub (unit tests pass)
- [x] User record created in MongoDB (unit tests pass)
- [x] Default account created on first login (unit tests pass)
- [x] Session cookie works correctly (unit tests pass)
- [ ] E2E test with real GitHub OAuth (requires manual testing)

### Phase 2 Verification

- [x] GitHub App can be installed (installation callback route implemented)
- [x] Installation ID stored in account (unit tests pass)
- [x] Repositories fetched from installation (unit tests pass)
- [x] Workflow dispatch works with installation token (unit tests pass)
- [ ] E2E test with real GitHub App (requires app setup - see docs/GitHub_App_Setup.md)

### Phase 3 Verification

- [x] API key can be generated (unit tests pass)
- [x] API key authentication works (unit tests pass)
- [x] Invitation system works (unit tests pass)
- [x] Account membership and access control works (unit tests pass)
- [x] Role-based team management works (unit tests pass)
- [x] Account context middleware works (unit tests pass)
- [ ] E2E test with real API key flow (requires integration testing)

### Phase 4 Verification

- [ ] Stripe checkout works
- [ ] Subscription created on payment
- [ ] Plan limits enforced (repo count, user count, private repos)
- [ ] Billing portal accessible

### Phase 5 Verification

- [ ] Landing page renders correctly
- [ ] Signup flow works end-to-end
- [ ] Onboarding guides user through setup

### E2E Test

```bash
# After all phases
yarn test:e2e
```
