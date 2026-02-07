# Codebase Concerns

**Analysis Date:** 2026-02-07

## Security Issues

### Open Redirect Vulnerability

**Issue:** Unvalidated `returnTo` parameter allows redirects to external URLs

**Files:** `src/server/routes/onboarding/index.ts` (line 225-226)

**Impact:** Attackers can craft malicious links with `returnTo=https://attacker.com` to phish users after authentication

**Fix approach:** Validate that `returnTo` is a relative path (starts with `/`) or use allowlist of safe paths before redirecting

### JSON.parse Without Try-Catch

**Issue:** Unsafe JSON parsing without error handling creates unprotected exception path

**Files:** `src/server/routes/services/index.ts` (line 248)

**Impact:** Malformed cookie data could crash the request handler instead of gracefully handling the error. While cookies are signed, the `unsignCookie()` method could return invalid JSON.

**Fix approach:** Wrap `JSON.parse()` in try-catch block with fallback to redirect on parse failure

### Missing Environment Variable Validation

**Issue:** Critical environment variables loaded without presence checking at startup

**Files:** `src/index.ts` (lines 21, 30-31, 41, 47-48)

**Impact:** Server starts with undefined credentials, causing failures only when first request arrives. No early feedback on misconfiguration.

**Fix approach:** Validate all required env vars exist and are non-empty before creating service instances

### Unvalidated Error Message Exposure

**Issue:** Raw error.message is returned to clients in API responses

**Files:** `src/server/routes/api/builds.ts` (lines 88-90), `src/server/routes/services/settings.ts`, `src/server/routes/api/environments.ts`

**Impact:** Internal error details (database field names, library errors) leak to clients, aiding reconnaissance

**Fix approach:** Map errors to generic user-facing messages; log raw errors server-side only

### Missing Null Check After Optional Chaining

**Issue:** Code accesses `request.apiKey!` with non-null assertion without prior check

**Files:** `src/server/routes/api/builds.ts` (line 52, 104)

**Impact:** If preHandler doesn't run or fails, code assumes apiKey exists, causing runtime errors

**Fix approach:** Add explicit `if (!request.apiKey)` check or ensure preHandler always runs before main handler

## Performance Bottlenecks

### SSE Stream Memory Leak in Unfinished Build Stream

**Issue:** `/build-created-stream/:serviceId` has infinite event queue without consumer

**Files:** `src/server/build/index.ts` (lines 123-145)

**Impact:** If client subscribes but events never emit, resolver stays alive indefinitely waiting for data. Multiple long-lived connections could grow unbounded, exhausting memory.

**Fix approach:** Add timeout (similar to `/build-update-stream`) to emit keep-alive or close connection after inactivity. Cancel pending resolver on socket close.

### Race Condition in Event Queue Consumer

**Issue:** Promise resolver reference can be lost if multiple concurrent operations occur

**Files:** `src/server/build/index.ts` (lines 53-54, 130-131)

**Impact:** If event listener fires while generator is still creating the promise, resolver could be null, dropping events silently

**Fix approach:** Use async queue or message channel instead of single resolver reference

### N+1 Repository Queries in Dashboard

**Issue:** Service list loads all services, then later calls load repositories per service (implied by structure)

**Files:** `src/server/routes/services/settings.ts` (line 70)

**Impact:** Showing 10 services requires 11 database queries instead of 1 join

**Fix approach:** Add repository in service document or use aggregation pipeline to fetch related data

## Data Validation Gaps

### Missing Service Name Validation

**Issue:** Service names only checked for existence and length, no validation for valid characters

**Files:** `src/server/routes/services/index.ts` (line 100)

**Impact:** Service names could contain special characters that break workflow dispatch or GitHub API calls

**Fix approach:** Add regex validation (alphanumeric, hyphens, underscores only) and max length enforcement

### Unvalidated Environment Names

**Issue:** Environment names passed directly to GitHub workflow without sanitization

**Files:** `src/server/routes/api/environments.ts` (multiple creation endpoints)

**Impact:** Special characters in environment names could break workflow payload JSON or cause injection attacks

**Fix approach:** Validate environment names match safe pattern before storage and use

### Missing Workflow File Path Validation

**Issue:** `workflowFile` parameter not validated before GitHub API dispatch

**Files:** `src/server/routes/services/index.ts` (line 395)

**Impact:** Path traversal via `../../sensitive/file.yml` could attempt to execute unintended workflows

**Fix approach:** Validate workflow file is filename only (no path separators), has `.yml`/`.yaml` extension

## Missing Error Handling

### Unhandled Promise Rejection in GitHub Fetch

**Issue:** GitHub workflow fetch failure logs error but continues rendering page

**Files:** `src/server/routes/services/index.ts` (lines 340-350)

**Impact:** Empty workflows dropdown appears to be empty repository, confusing users about true error

**Fix approach:** Return 500 or explicitly show "Failed to load workflows - please refresh" in HTML response

### Stripe Webhook Signature Verification Gap

**Issue:** Three modes of signature handling - one skips actual verification if verifier not provided

**Files:** `src/server/routes/webhooks/stripe.ts` (lines 54-64)

**Impact:** Legacy mode accepts any request with signature header present but doesn't validate it. Easy to accidentally use in production.

**Fix approach:** Remove legacy mode, require signatureVerifier in production

## Data Integrity Issues

### Missing Transaction in Multi-Step Operations

**Issue:** Service creation saves to DB then generates API key - no transaction

**Files:** `src/server/routes/services/index.ts` (lines 152-165)

**Impact:** If API key generation fails after service is saved, orphaned service exists without key. User sees creation "succeeded" but no key to configure.

**Fix approach:** Wrap in database transaction or use compensating transactions (delete service on key generation failure)

### Duplicate Service Name Handling

**Issue:** MongoDB error code 11000 caught and displayed, but no index defined in code

**Files:** `src/server/routes/services/index.ts` (lines 196-214)

**Impact:** Unique constraint relies on implicit MongoDB behavior. If index missing, duplicate services silently created instead of returning error.

**Fix approach:** Ensure unique index defined in `ServiceRepository.ensureIndexes()`

## Session & Authentication Risks

### Seven-Day Session Timeout is Long

**Issue:** JWT session tokens valid for 7 days without refresh mechanism

**Files:** `src/services/auth/sessionService.ts` (line 18)

**Impact:** Compromised session token valid for a week. No way for user to invalidate sessions (logout doesn't revoke JWT).

**Fix approach:** Reduce to 24 hours or implement session revocation list stored in Redis/database

### Session ID Stored in Plain Text

**Issue:** Session payload stored as unencrypted JWT without additional encryption

**Files:** `src/services/auth/sessionService.ts` (lines 29-37)

**Impact:** If HTTPS is disabled or man-in-the-middle occurs, session tokens exposed in plain text

**Fix approach:** Implement opaque session tokens with server-side storage in database

## Fragile Areas

### SSE Event Emission Coupling

**Issue:** Build service calls are tightly coupled to event emitter in main module

**Files:** `src/services/build/buildService.ts` depends on EventEmitter passed in constructor

**Impact:** Difficult to test build operations without event emitter. Missing events means dashboard doesn't update.

**Test coverage:** Build service events tested but not integration with actual event routing

**Safe modification:** Add interface for event emission to decouple from concrete EventEmitter class

### Handlebars Template XSS Risk

**Issue:** Service names and build IDs rendered directly in SSE template without escaping in some cases

**Files:** `src/server/build/index.ts` (lines 65-76) uses `buildId`, `serviceName` in template

**Impact:** If service name contains HTML, could break SSE event formatting or inject arbitrary script

**Fix approach:** Use template escaping helpers or sanitize data before template render

## Test Coverage Gaps

### No E2E Tests for OAuth Flow

**Issue:** GitHub OAuth login tested in E2E but provider mocked, not end-to-end

**Files:** `e2e/auth.spec.ts` uses MSW to mock GitHub endpoints

**Impact:** Real GitHub authentication path never tested in CI. Token refresh/expiry scenarios unknown.

**Priority:** Medium - login is critical path but high trust in GitHub SDK

### Missing Tests for Concurrent API Calls

**Issue:** No tests for simultaneous build creation or deployment across services

**Files:** No concurrent request tests in `src/server/routes/api/builds.test.ts`

**Impact:** Race conditions in event emission or repository state updates not caught

**Priority:** High - multi-user platform at risk

### No Stripe Webhook Signature Verification Tests

**Issue:** Signature verification tests use mock verifier, not real Stripe signature

**Files:** `src/server/routes/webhooks/stripe.test.ts` doesn't test real signature validation

**Impact:** Real Stripe webhook injection possible if implementation broken

**Priority:** High - financial/security critical

## Dependencies at Risk

### Handlebars XSS History

**Issue:** Handlebars has history of XSS vulnerabilities. Using version 4.7.8 but not on latest 4.x

**Files:** `package.json` line 30: `"handlebars": "^4.7.8"`

**Impact:** Vulnerable to template injection if user input used as template (currently not, but risky pattern)

**Migration plan:** Monitor Handlebars releases for patch versions; test before upgrading major version

### jsonwebtoken Library Usage

**Issue:** JWT verification errors silently caught, making replay attacks harder to detect

**Files:** `src/services/auth/sessionService.ts` line 47: catch silently returns null

**Impact:** No audit trail of failed token validations

**Recommendation:** Log failed validations with timestamp and IP for fraud detection

## Missing Critical Features

### No Session Revocation on Logout

**Issue:** Logout endpoint doesn't exist or invalidate tokens

**Files:** No logout route found in codebase

**Impact:** User can't force logout other sessions. Token valid until expiry even after user knows it's compromised.

**Blocking:** Users can't truly logout

### No Rate Limiting on API Endpoints

**Issue:** No rate limiting implemented on build creation or deployment endpoints

**Files:** `src/server/routes/api/builds.ts`, `src/server/routes/api/environments.ts`

**Impact:** Attackers can spam build creation, DoS the system

**Blocking:** API endpoints vulnerable to abuse

### Missing Request Size Limits

**Issue:** Fastify body size limits not configured globally

**Files:** `src/server/createAppServer.ts` (not checked - likely missing)

**Impact:** Large payload attacks could exhaust memory

**Priority:** High - public API endpoints

## Code Quality Issues

### Magic Number in Timeout

**Issue:** 25000ms timeout hardcoded with comment but no configuration

**Files:** `src/server/build/index.ts` (line 57)

**Impact:** Can't adjust keep-alive without code change

**Fix approach:** Move to configuration constant or environment variable

### Generic Error Handling in Tests

**Issue:** Many tests catch errors with `catch (error: any)` losing type information

**Files:** Multiple test files

**Impact:** Makes debugging test failures harder

### Missing Input Length Validation

**Issue:** Service names, environment names accept unbounded input

**Files:** `src/server/routes/services/index.ts`, `src/server/routes/api/environments.ts`

**Impact:** Very long names could break UI rendering or database performance

**Fix approach:** Add max length validation (e.g., 100 characters) on all string inputs

---

_Security and quality audit: 2026-02-07_
