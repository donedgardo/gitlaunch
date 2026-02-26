# Phase 5: Simplify CI/CD Pipeline Setup with GitHub Action - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the current copy-paste workflow YAML (which requires duplicating status reporting for success, failure, and canceled outcomes) with a single reusable GitHub Action published on the marketplace. The existing `donedgardo/build-reporter` repo becomes a submodule called `github-action`. Users set up CI/CD with a short, complete workflow file instead of a massive paste.

</domain>

<decisions>
## Implementation Decisions

### Onboarding UX

- Inline copyable YAML snippet shown directly in the service settings page
- Snippet is pre-filled with the user's actual values (API key, service slug, repo)
- User copies a complete workflow file (~10-15 lines) — not just the action step
- Action version pinned to major version (@v1) — users get patches automatically

### Status Reporting Consolidation

- Single consolidated action handles BOTH deployment dispatch AND status reporting
- Action auto-detects the deployment outcome from job context (no explicit status input needed)
- Handles all three outcomes: success, failure, and canceled
- Replaces the current duplicated reporting blocks for each outcome

### Action Inputs

- Required inputs: `GITLAUNCH_API_KEY`, `service-name`, `environment` (staging/prod)
- Action infers the rest from GitHub context (repo, commit SHA, branch, etc.)

### Claude's Discretion

- Submodule setup and repo structure details
- action.yml schema and implementation approach
- How auto-detection of job outcome works (likely `job.status` or `steps.*.outcome`)
- Marketplace publishing workflow and release tagging
- Exact YAML structure of the minimal workflow file

</decisions>

<specifics>
## Specific Ideas

- Existing action repo is `donedgardo/build-reporter` — becomes submodule called `github-action`
- The current workflow has massive duplication for failure/success/canceled status reporting — all of that should collapse into the action
- The goal is absolute minimum friction: pre-filled snippet in dashboard, one copy-paste, done

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

_Phase: 05-simplify-ci-cd-pipeline-setup-with-github-action_
_Context gathered: 2026-02-26_
