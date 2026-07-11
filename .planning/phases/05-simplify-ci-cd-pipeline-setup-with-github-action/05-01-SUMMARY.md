---
phase: 05-simplify-ci-cd-pipeline-setup-with-github-action
plan: 01
subsystem: infra
tags: [github-actions, ci-cd, typescript, submodule, ncc]

# Dependency graph
requires:
  - phase: 04-trial-payment-lifecycle
    provides: Stable billing/deployment API surface the action reports against
provides:
  - Consolidated GitHub Action with a single invocation for deploy status reporting
  - post-step auto-detection of job outcome (deployed/error/cancelled) via GITHUB_JOB_STATUS with core.saveState fallback
  - Retained report-build mode for CI build reporting
affects: [05-02-templates-and-workflow-migration, ci-cd-onboarding]

# Tech tracking
tech-stack:
  added:
    - "@actions/github (job-status context in post step)"
  patterns:
    - "action.yml post: entry point for auto-outcome detection"
    - "core.saveState in main step, core.getState in post step"
    - "ncc build output to dist/index.js and dist/post/index.js"

key-files:
  created:
    - github-action/src/post.ts
    - github-action/src/post.test.ts
  modified:
    - github-action/action.yml
    - github-action/src/index.ts
    - github-action/src/index.test.ts

key-decisions:
  - "Single consolidated action handles BOTH dispatch (deploying) AND final status reporting"
  - "Outcome auto-detected via GITHUB_JOB_STATUS env var, falling back to saved state"
  - "Required inputs reduced to api-key, service-id, environment (no explicit status)"
  - "post step handles missing state silently (main step skipped) without failing the job"
  - "Version bumped to @v2 across the repo (plans referenced @v1; @v2 is the shipped major)"

patterns-established:
  - "post: dist/post/index.js in action.yml is the mechanism for post-job outcome reporting"
  - "State handoff between main and post via core.saveState/getState"

requirements-completed: [CICD-01]

# Metrics
duration: reconciled
completed: 2026-07-11
---

# Phase 5, Plan 01: Consolidated GitHub Action Summary

**GitHub Action collapsed from a 4-call status-reporting workflow into a single invocation whose post step auto-detects and reports the final deploy outcome.**

## Performance

- **Duration:** implemented in a prior session; reconciled and verified 2026-07-11
- **Tasks:** 3 (RED / GREEN / REFACTOR) + formatting cleanup
- **Files modified:** 5 (in `github-action/` submodule)
- **Tests:** 13 passing (post.test.ts=5, index.test.ts=8)

## Accomplishments

- Main step reports `deploying` and persists context (service_id, environment, build_id, api_url) via `core.saveState`
- New `post.ts` runs automatically after the job, reads `GITHUB_JOB_STATUS` (with saved-state fallback), and PATCHes `deployed`/`error`/`cancelled`
- `report-build` mode preserved for CI build reporting
- Post step gracefully no-ops when the main step was skipped (no saved state)
- Inputs reduced to `api-key`, `service-id`, `environment`

## Task Commits

Implemented in the `github-action` submodule (repo: donedgardo/build-reporter):

1. **RED — deploy mode and post step auto-detection** - `46ccbff` (test)
2. **GREEN — deploy mode with post-step auto-outcome detection** - `1525f05` (feat)
3. **REFACTOR — wire post step into action.yml and build pipeline** - `ebef4e9` (refactor)
4. **Prettier line-wrapping cleanup** - `2a54982` (refactor, reconciliation)

Parent-repo submodule pointer bumped: `18144f7` (parent), original deploy-mode bump `1bda832`.

_Note: submodule commit `2a54982` is 1 ahead of `origin/main` — push the submodule before publishing the parent pointer._

## Files Created/Modified

- `github-action/src/post.ts` - Post-step auto-outcome detection and final status reporting
- `github-action/src/post.test.ts` - Tests for success/failure/cancelled/no-state paths
- `github-action/src/index.ts` - Deploy mode with saveState; report-build mode retained
- `github-action/src/index.test.ts` - Tests for deploy-mode saveState calls
- `github-action/action.yml` - `post: dist/post/index.js`, consolidated inputs

## Deviations from Plan

- Action version is `@v2` throughout (plans wrote `@v1`); consistent, intentional major bump. Consolidated-action intent fully met.

## Verification

Confirmed by 05-VERIFICATION.md: 5/5 truths, 5/5 artifacts, 2/2 key links. CICD-01 satisfied. `cd github-action && yarn test` → 13 passing.
