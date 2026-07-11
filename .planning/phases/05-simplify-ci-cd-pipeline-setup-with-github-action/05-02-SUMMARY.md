---
phase: 05-simplify-ci-cd-pipeline-setup-with-github-action
plan: 02
subsystem: ui
tags: [handlebars, onboarding, github-actions, workflow-yaml]

# Dependency graph
requires:
  - phase: 05-01
    provides: Consolidated GitHub Action (single-step deploy + post-step auto-detection)
provides:
  - Settings page renders a single consolidated deploy workflow snippet (no 4-step status pattern)
  - Onboarding (created.hbs) shows the consolidated deploy workflow as a setup step
  - Launchpad's own deploy.yml and test-deploy workflows migrated to the consolidated action
  - Regression test guarding the consolidated snippet on the settings page
affects: [ci-cd-onboarding, user-facing-setup]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single donedgardo/build-reporter@v2 step with action: deploy (no explicit status:)"
    - "Pre-filled snippet via {{#each environments}} from settings route context"

key-files:
  created: []
  modified:
    - src/templates/partials/deploymentSetupGuide.hbs
    - src/templates/services/created.hbs
    - src/server/routes/services/settings.test.ts
    - .github/workflows/deploy.yml
    - .github/workflows/test-deploy-success.yml
    - .github/workflows/test-deploy-error.yml
    - .github/workflows/test-deploy-cancelled.yml

key-decisions:
  - "Dashboard shows an inline pre-filled YAML snippet users copy once"
  - "deploy.yml and all three test-deploy workflows use the single action: deploy pattern"
  - "settings.ts needed no change — it already passes service.id, serviceId, environments"
  - "References use @v2 consistently (plans wrote @v1)"

patterns-established:
  - "Consolidated deploy snippet is the canonical onboarding instruction"

requirements-completed: [CICD-02, CICD-03]

# Metrics
duration: reconciled
completed: 2026-07-11
---

# Phase 5, Plan 02: Dashboard Templates & Workflow Migration Summary

**Onboarding and Launchpad's own CI/CD were migrated from the verbose 4-step status pattern to the single consolidated build-reporter action, giving users a short copy-once deploy snippet.**

## Performance

- **Duration:** implemented across prior UI commits; regression test added and reconciled 2026-07-11
- **Tasks:** 2 (templates + workflow migration), plus the guarding test
- **Files modified:** 7
- **Tests:** full parent suite 510 passing; settings.test.ts now 8 (added consolidated-snippet guard)

## Accomplishments

- `deploymentSetupGuide.hbs` renders one `donedgardo/build-reporter@v2` deploy step (api-key + service-id + environment, `action: deploy`), pre-filled from the service's environments
- `created.hbs` presents the consolidated deploy workflow as a numbered onboarding step
- `deploy.yml` and `test-deploy-{success,error,cancelled}.yml` migrated to the single-step pattern with no explicit `status:`
- Added regression test asserting GET `/services/:serviceId/settings` renders `donedgardo/build-reporter` and NOT the old `action: update-status` / `status: deployed` pattern

## Task Commits

Delivered across prior parent-repo commits:

1. **Consolidate deploy workflow to single action step with auto-detection** - `da30ebe` (feat)
2. **Update all workflow and template references to build-reporter@v2** - `7cd6c9b` (chore)
3. **Simplify deploy step — single workflow view with terminal PR and auto-deploy tip** - `569929b` (feat)
4. **Regression test guarding consolidated snippet on settings page** - `154c00f` (test, reconciliation)

## Files Created/Modified

- `src/templates/partials/deploymentSetupGuide.hbs` - Consolidated single-step deploy snippet
- `src/templates/services/created.hbs` - Onboarding shows the consolidated deploy workflow
- `src/server/routes/services/settings.test.ts` - Test verifying the settings page renders the consolidated snippet
- `.github/workflows/deploy.yml` - Migrated to the consolidated action
- `.github/workflows/test-deploy-{success,error,cancelled}.yml` - Migrated to the consolidated action

## Deviations from Plan

- `@v2` used throughout instead of `@v1` (consistent with 05-01's shipped major version).
- The regression test required by the plan was missing from the original implementation; added during reconciliation (05-VERIFICATION.md's single flagged gap, now closed).

## Verification

Confirmed by 05-VERIFICATION.md: 05-02 truths/artifacts verified with the one missing-test gap now closed. CICD-02 and CICD-03 satisfied. Parent suite: 510 passing.
