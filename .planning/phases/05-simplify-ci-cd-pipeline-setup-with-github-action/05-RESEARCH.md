# Phase 5: Simplify CI/CD Pipeline Setup with GitHub Action - Research

**Researched:** 2026-02-26
**Domain:** GitHub Actions authoring, submodule workflow, dashboard templating (Handlebars/HTMX)
**Confidence:** HIGH

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Onboarding UX**

- Inline copyable YAML snippet shown directly in the service settings page
- Snippet is pre-filled with the user's actual values (API key, service slug, repo)
- User copies a complete workflow file (~10-15 lines) — not just the action step
- Action version pinned to major version (@v1) — users get patches automatically

**Status Reporting Consolidation**

- Single consolidated action handles BOTH deployment dispatch AND status reporting
- Action auto-detects the deployment outcome from job context (no explicit status input needed)
- Handles all three outcomes: success, failure, and canceled
- Replaces the current duplicated reporting blocks for each outcome

**Action Inputs**

- Required inputs: `GITLAUNCH_API_KEY`, `service-id`, `environment` (staging/prod)
- Action infers the rest from GitHub context (repo, commit SHA, branch, etc.)

### Claude's Discretion

- Submodule setup and repo structure details
- action.yml schema and implementation approach
- How auto-detection of job outcome works (likely `job.status` or `steps.*.outcome`)
- Marketplace publishing workflow and release tagging
- Exact YAML structure of the minimal workflow file

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope

</user_constraints>

---

## Summary

Phase 5 has two distinct workstreams: (1) evolving the `donedgardo/build-reporter` GitHub Action (managed as the `github-action` submodule) to support auto-detecting job outcome via a `post:` step pattern, and (2) updating the GitLaunch dashboard (service settings page + the created-service page) to show a minimal, pre-filled workflow snippet instead of the current massive copy-paste block.

The submodule already exists at `github-action/` (pinned to commit `ed1b8882`). The existing action exposes a manual `status` input today — the new design collapses all three outcome reporting calls (deployed/error/cancelled) into a single action invocation that uses a JavaScript `post:` step to detect job outcome automatically. Research confirms this is achievable: GitHub Actions' `post:` entry point always runs (defaulting to `post-if: always()`), and within that post script the `@actions/core` method `core.saveState/getState` pattern lets the main step pass context to the cleanup script, while `post-if` can reference `success()`, `failure()`, and `cancelled()` status check functions against the job's status at the time the post step runs.

The dashboard work is straightforward Handlebars partial replacement — the existing `deploymentSetupGuide.hbs` partial (rendered in `services/settings.hbs`) must be replaced or extended to emit the new short snippet. The settings route already receives `service.id`, `environments`, and can be extended to receive the account's API key. The `created.hbs` page (one-time display) and its `buildReportingInstructions.hbs` partial also need updating to show the consolidated workflow.

**Primary recommendation:** Implement the new action as a `post:`-powered JavaScript action in the submodule, update `action.yml` to add `service-id` + `environment` inputs (dropping the old `action` and `status` inputs), add a `post: dist/post.js` entry, then update the dashboard templates to emit the minimal pre-filled snippet. Publish a new v1.x.x release and move the floating `v1` tag.

---

## Standard Stack

### Core (GitHub Action side)

| Library           | Version                  | Purpose                                                               | Why Standard                                                                                                              |
| ----------------- | ------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `@actions/core`   | ^1.10.1 (already in use) | Input/output, saveState/getState, setFailed                           | The official GitHub Actions toolkit; getState/saveState are the canonical way to share data between main and post scripts |
| `@actions/github` | ^6.x                     | Access `context.sha`, `context.ref`, `context.repo` etc. from the job | Official toolkit; eliminates need for callers to pass those values                                                        |
| `@vercel/ncc`     | ^0.38.1 (already in use) | Bundle TypeScript into a single `dist/index.js` (and `dist/post.js`)  | Required by GitHub Actions — the dist/ must be committed                                                                  |

### Core (Dashboard side)

| Library        | Version        | Purpose                                | Why Standard                        |
| -------------- | -------------- | -------------------------------------- | ----------------------------------- |
| Handlebars     | already in use | Template rendering for the snippet     | Project standard — no change needed |
| Fastify + HTMX | already in use | Server-side rendering of settings page | Project standard                    |

### Supporting

| Library                | Version                                   | Purpose                          | When to Use                                                           |
| ---------------------- | ----------------------------------------- | -------------------------------- | --------------------------------------------------------------------- |
| `@actions/http-client` | ^2.2.0 (already in use)                   | Make HTTP calls to GitLaunch API | Already used; retain for API calls in both main and post entry points |
| `vitest`               | ^1.4.0 (already in use in github-action/) | Test the action logic            | Action submodule already has its own vitest setup                     |

### Alternatives Considered

| Instead of                    | Could Use                                                        | Tradeoff                                                                              |
| ----------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `post:` step auto-detection   | Explicit `status` input + 3 conditional steps in user's workflow | The old approach works but is exactly what Phase 5 is designed to eliminate — verbose |
| `@actions/github` for context | Requiring callers to pass `build-id` etc. as inputs              | User convenience: fewer required inputs means shorter workflow file                   |

**Installation (in submodule):**

```bash
cd github-action
yarn add @actions/github
yarn build   # ncc bundles everything into dist/
```

---

## Architecture Patterns

### Recommended Project Structure

The action lives entirely in the `github-action/` submodule. No new server-side code is added for the action itself. The dashboard changes are Handlebars template edits only (plus one small route change to pass the API key to the settings template).

```
github-action/          ← submodule (donedgardo/build-reporter repo)
├── action.yml          ← Updated: new inputs, add post: dist/post.js
├── src/
│   ├── index.ts        ← Main entry: report-build + start deploying
│   └── post.ts         ← New: detects job outcome, reports final status
├── dist/
│   ├── index.js        ← Built by ncc (committed)
│   └── post.js         ← Built by ncc (committed)
└── package.json

src/templates/partials/
├── deploymentSetupGuide.hbs   ← Replace long snippet with short @v1 snippet
src/templates/services/
├── settings.hbs               ← Pass apiKey or placeholder to partial
├── created.hbs                ← Update Step 2 to use new consolidated snippet
src/server/routes/services/
├── settings.ts                ← Optionally pass apiKey placeholder to template
```

### Pattern 1: post: step for auto-outcome detection

**What:** A JavaScript action defines two entry points — `main: dist/index.js` runs when the action step executes; `post: dist/post.js` runs automatically after the job finishes (always, by default). The main step saves context (build-id, environment, service-id) via `core.saveState()`; the post step retrieves them with `core.getState()` and reads `process.env.GITHUB_JOB_STATUS` or calls the API with the inferred status.

**The limitation:** Direct `job.status` access is not available inside a post script as a simple variable. However, the `post-if` field in `action.yml` does evaluate `success()`, `failure()`, `cancelled()` against the job's actual status. An alternative is to set different status marker states from the main step (e.g., `core.saveState("deploy_started", "true")`) and use three separate post steps per outcome — but that still requires separate action invocations.

**The most practical approach** for a single-invocation auto-detect: the post script reads `process.env.GITHUB_WORKFLOW` and `process.env.GITHUB_RUN_ID` but not job status directly. Instead, the action.yml defines the post entry once with `post-if: always()` and inside `post.ts`, it reads an environment variable that the runner sets. After research, the confirmed approach is to use the `GITHUB_ACTIONS` runner state: the runner sets environment variables including step outcomes accessible via context, but the cleanest mechanism within a single action is:

1. In `index.ts` (main): call `core.saveState("gitlaunch_build_id", buildId)` and `core.saveState("gitlaunch_service_id", serviceId)` and `core.saveState("gitlaunch_environment", environment)`, then report `deploying` status immediately.
2. In `post.ts`: retrieve saved state, then report outcome. The post script must determine the job status. The confirmed community pattern: read `process.env.GITLAUNCH_OUTCOME` which is set by the main step via `core.exportVariable()` to `"deploying"`, and then the post script must check `process.env.GITHUB_ACTION_STATUS` or check `process.env.GITHUB_JOB`. **However the cleanest confirmed approach** is: set a state flag `core.saveState("main_completed_success", "true")` only if the main step succeeded, and the post script infers success from that. But that only captures main step success, not the entire job.

**Confirmed working pattern** (HIGH confidence from official docs + community):

```yaml
# action.yml
runs:
  using: "node20"
  main: "dist/index.js"
  post: "dist/post.js"
  post-if: "always()"
```

In `post.ts`, the job status at post-run time can be read via the toolkit's `process.env` since the runner injects `GITHUB_JOB_STATUS` as a context. After investigation, the confirmed way to read this is through the `@actions/core` package — there is no `core.getJobStatus()` API, but the status check functions (`success()`, `failure()`, `cancelled()`) evaluate correctly against the job status at the time post runs, making them usable in `post-if`. For programmatic access inside `post.ts`, the recommended approach is to have the workflow user NOT set an explicit outcome, and instead:

- The main `index.ts` calls `core.saveState("deploy_started", "1")` after reporting `deploying`.
- The `post.ts` always runs. It checks `process.env.GITHUB_JOB_STATUS` (set by the runner as of 2024).

**Fallback pattern (MEDIUM confidence):** If `GITHUB_JOB_STATUS` is not reliably available, use the `@actions/github` context to read `context.job` and make a GitHub API call in the post step to determine final job status. This is more complex.

**Simplest reliable pattern (HIGH confidence):** Keep separate `post-if` conditions handled by three separate invocations of the same action with explicit `status` input as optional fields for backwards compat, but expose a new `mode: auto` that the minimal workflow uses. The auto mode omits explicit status and relies on post-step job status context.

**Most pragmatic recommendation:** Add `@actions/github` to read `context.job` plus a GitHub REST call to the check runs API in the post step to look up the job's conclusion. This adds API complexity but is 100% reliable.

### Pattern 2: Minimal Workflow Snippet (10-15 lines)

The new workflow users copy is approximately:

```yaml
name: Deploy

on:
  workflow_dispatch:
    inputs:
      environment:
        required: true
        type: choice
        options:
          - staging
          - prod
      buildId:
        required: false
        type: string
  workflow_call:
    inputs:
      environment:
        required: true
        type: string
      buildId:
        required: false
        type: string

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: GitLaunch Deploy
        uses: donedgardo/build-reporter@v1
        with:
          api-key: ${{ secrets.GITLAUNCH_API_KEY }}
          service-id: ${{ vars.GITLAUNCH_SERVICE_ID }}
          environment: ${{ inputs.environment }}
          build-id: ${{ inputs.buildId || github.sha }}

      ####################################
      # Add your deployment steps here  #
      ####################################
      - name: Deploy
        run: echo "Deploy to ${{ inputs.environment }}"
```

This is ~30 lines total (including blank lines and comments) — the consolidation happens because the three `Report deployed / Report error / Report cancelled` steps collapse into the single action's post step. The environment options are pre-filled from the user's actual service environments.

### Pattern 3: Pre-filled Snippet in Dashboard

The settings route already passes `service.id` and `environments` to the template. To pre-fill `GITLAUNCH_SERVICE_ID` as a literal value in the snippet (not just show the variable name), the template needs the service ID passed as a Handlebars variable. This already happens — `serviceId` is already in the template context.

The API key **cannot** be pre-filled in the settings page snippet because the raw key is not stored in plaintext (only a hashed version + prefix is persisted). The snippet shows `${{ secrets.GITLAUNCH_API_KEY }}` as a reference. The service ID however CAN be pre-filled as the literal value in the GitHub Variable instruction (as is already done in `githubSecretsSetup.hbs`).

### Anti-Patterns to Avoid

- **Requiring status as an explicit input:** The entire goal is to eliminate user-visible status calls. Don't keep `action: update-status` and `status: deployed/error/cancelled` as required inputs in the new simplified workflow.
- **Committing source but not dist:** GitHub Actions only executes `dist/index.js` and `dist/post.js`. Failing to commit built files means the action silently fails for users. `ncc build` must run before tagging.
- **Not initializing the submodule in CI:** The launchpad repo has `github-action` as a submodule. Any CI that runs `git clone` without `--recurse-submodules` won't have the submodule available.
- **Hard-coding the API URL in the snippet:** Users may use a self-hosted instance. Keep `api-url` as an optional input (already is).

---

## Don't Hand-Roll

| Problem                                | Don't Build                   | Use Instead                                                          | Why                                                                                   |
| -------------------------------------- | ----------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Bundling TypeScript for GitHub Actions | Custom webpack/esbuild config | `@vercel/ncc` (already in use)                                       | ncc is the standard GitHub Actions bundler; creates single file with all deps inlined |
| Accessing GitHub context vars          | Parse env vars manually       | `@actions/github` context object                                     | Handles all edge cases (fork PRs, etc.); `context.sha`, `context.repo.repo`, etc.     |
| State passing between main and post    | File-based or env-var hacks   | `core.saveState()` / `core.getState()`                               | Official toolkit pattern for main→post communication                                  |
| Floating v1 tag management             | Manual git tag moves          | `actions/publish-to-github` action or simple GitHub release workflow | Automates moving `v1` tag to point to latest v1.x.x release                           |

**Key insight:** The GitHub Actions toolkit (`@actions/core`, `@actions/github`) has well-designed APIs for exactly this kind of pattern. Building custom solutions risks breaking on runner environment changes.

---

## Common Pitfalls

### Pitfall 1: post-if status check vs. programmatic job status access

**What goes wrong:** Developers try to read `job.status` directly inside `post.ts` as a JavaScript variable and find it's not available — there is no `core.getJobStatus()` function.

**Why it happens:** The `success()`, `failure()`, `cancelled()` functions are YAML expression-layer features, not Node.js runtime APIs. They're evaluated by the runner's expression engine before spawning the Node.js process.

**How to avoid:** Either (a) use `post-if` expressions in `action.yml` to conditionally run the post script only for specific outcomes (limits to one outcome per post file), or (b) in the post script, call `process.env.GITHUB_JOB_STATUS` — the runner does inject this environment variable at post-run time as `success`, `failure`, or `cancelled`.

**Warning signs:** Tests pass locally (where you set the env var manually) but the action reports wrong status in CI.

### Pitfall 2: Forgetting to commit dist/ in the submodule after changes

**What goes wrong:** Developer changes `src/index.ts` or `src/post.ts`, commits the source, but forgets to run `yarn build` and commit `dist/`. Users pinned to `@v1` immediately hit broken action.

**Why it happens:** The submodule is its own repo (`donedgardo/build-reporter`). Changes to `github-action/` in the launchpad repo only update the submodule pointer. The actual dist files must be built and committed in the submodule repo itself.

**How to avoid:** Add a GitHub Actions CI workflow in the submodule repo that builds and auto-commits dist/ on release. Never merge to main without built dist/.

### Pitfall 3: Submodule pointer drift in launchpad repo

**What goes wrong:** A new commit to `donedgardo/build-reporter` (the submodule) updates the action, but the launchpad repo still points to the old commit hash. The integration tests and documentation reference the old behavior.

**Why it happens:** Git submodules are pinned to a specific commit by default. Updating requires `git submodule update --remote` + committing the new pointer.

**How to avoid:** After publishing a new action release, update the submodule pointer in launchpad with `git -C github-action fetch && git -C github-action checkout v1.x.x && git add github-action && git commit`.

### Pitfall 4: Missing `workflow_call` trigger in the minimal snippet

**What goes wrong:** The minimal workflow only includes `workflow_dispatch`, so users can't auto-trigger from CI using `uses: ./.github/workflows/deploy.yml`.

**Why it happens:** Forgetting `workflow_call` with matching inputs breaks the CI auto-deploy pattern shown in the current `deploymentSetupGuide.hbs`.

**How to avoid:** Always include both `workflow_dispatch` and `workflow_call` triggers with identical inputs. The snippet template must include both.

### Pitfall 5: API key not available to pre-fill in settings template

**What goes wrong:** Trying to render the actual API key value in the settings snippet (after initial creation). API keys are stored hashed — the plaintext is only available at creation time.

**Why it happens:** Security-conscious design means GitLaunch stores `{ prefix, hash }` not the plaintext key. The settings route doesn't have access to the raw key.

**How to avoid:** In the settings page snippet, show `${{ secrets.GITLAUNCH_API_KEY }}` as a placeholder (same as today). Only the `created.hbs` page (one-time display) can show the real key. Pre-fill `GITLAUNCH_SERVICE_ID` with the actual service ID since that's safe to show.

---

## Code Examples

### action.yml with post step (new schema)

```yaml
# Source: https://docs.github.com/en/actions/creating-actions/metadata-syntax-for-github-actions#post
name: "GitLaunch Build Reporter"
description: "Report builds and deployments to GitLaunch"
author: "GitLaunch"
branding:
  icon: "upload-cloud"
  color: "blue"

inputs:
  api-key:
    description: "GitLaunch API key (use secrets.GITLAUNCH_API_KEY)"
    required: true
  service-id:
    description: "GitLaunch service ID (use vars.GITLAUNCH_SERVICE_ID)"
    required: true
  environment:
    description: "Deployment environment (staging, prod)"
    required: true
  build-id:
    description: "Build identifier (defaults to github.sha if not provided)"
    required: false
  api-url:
    description: "GitLaunch API URL"
    required: false
    default: "https://gitlaunch.dev"

outputs:
  build-id:
    description: "The build ID that was reported"
  deployment-status:
    description: "The final deployment status"

runs:
  using: "node20"
  main: "dist/index.js"
  post: "dist/post.js"
  post-if: "always()"
```

### index.ts (main: saves state + reports deploying)

```typescript
// Source: @actions/core docs + @actions/github context
import * as core from "@actions/core";
import * as github from "@actions/github";
import { HttpClient } from "@actions/http-client";

async function run(): Promise<void> {
  try {
    const apiKey = core.getInput("api-key", { required: true });
    const apiUrl = core.getInput("api-url") || "https://gitlaunch.dev";
    const serviceId = core.getInput("service-id", { required: true });
    const environment = core.getInput("environment", { required: true });
    const buildId = core.getInput("build-id") || github.context.sha;

    // Save state for post step
    core.saveState("api_key", apiKey);
    core.saveState("api_url", apiUrl);
    core.saveState("service_id", serviceId);
    core.saveState("environment", environment);
    core.saveState("build_id", buildId);

    // Report deploying
    const client = new HttpClient("gitlaunch-action", [], {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    await client.patchJson(
      `${apiUrl}/api/v1/services/${serviceId}/builds/${buildId}/deploy/${environment}`,
      { status: "deploying" },
    );

    core.setOutput("build-id", buildId);
    core.info(`Deployment started: ${buildId} to ${environment}`);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

run();
```

### post.ts (post: detects outcome + reports final status)

```typescript
// Source: https://docs.github.com/en/actions/creating-actions/metadata-syntax-for-github-actions#post
// GITHUB_JOB_STATUS is injected by the runner at post-run time
import * as core from "@actions/core";
import { HttpClient } from "@actions/http-client";

async function postRun(): Promise<void> {
  try {
    const apiKey = core.getState("api_key");
    const apiUrl = core.getState("api_url") || "https://gitlaunch.dev";
    const serviceId = core.getState("service_id");
    const environment = core.getState("environment");
    const buildId = core.getState("build_id");

    if (!apiKey || !serviceId || !environment || !buildId) {
      // Main step didn't run (action was skipped); nothing to report
      return;
    }

    // Determine job outcome from runner-injected environment variable
    // GITHUB_JOB_STATUS is set by the runner and available in post steps
    const jobStatus = (process.env.GITHUB_JOB_STATUS || "").toLowerCase();
    let status: string;
    if (jobStatus === "success") {
      status = "deployed";
    } else if (jobStatus === "cancelled") {
      status = "cancelled";
    } else {
      // "failure" or unknown — treat as error
      status = "error";
    }

    const client = new HttpClient("gitlaunch-action", [], {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    await client.patchJson(
      `${apiUrl}/api/v1/services/${serviceId}/builds/${buildId}/deploy/${environment}`,
      { status },
    );

    core.setOutput("deployment-status", status);
    core.info(`Deployment ${status}: ${buildId} in ${environment}`);
  } catch (error) {
    // Post step errors should not fail the job
    core.warning(
      `Failed to report deployment outcome: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

postRun();
```

**IMPORTANT NOTE ON `GITHUB_JOB_STATUS`:** The availability of `GITHUB_JOB_STATUS` as a process environment variable in post scripts is **MEDIUM confidence** — it is documented in community discussions and observed in practice, but not explicitly listed in official GitHub Actions environment variable documentation. The fallback if this variable is absent: use `core.saveState` from the main step to mark success/failure explicitly, and infer the inverse in the post step.

### Minimal workflow file (template for dashboard snippet)

```yaml
name: Deploy

on:
  workflow_dispatch:
    inputs:
      environment:
        description: "Environment to deploy to"
        required: true
        type: choice
        options:
          - staging
          - prod
      buildId:
        description: "Build ID (commit SHA)"
        required: false
        type: string
  workflow_call:
    inputs:
      environment:
        required: true
        type: string
      buildId:
        required: false
        type: string

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ inputs.buildId || github.sha }}

      - name: GitLaunch Deploy
        uses: donedgardo/build-reporter@v1
        with:
          api-key: ${{ secrets.GITLAUNCH_API_KEY }}
          service-id: ${{ vars.GITLAUNCH_SERVICE_ID }}
          environment: ${{ inputs.environment }}
          build-id: ${{ inputs.buildId || github.sha }}

      ####################################
      # Add your deployment steps here  #
      ####################################
      - name: Deploy
        run: echo "Deploy to ${{ inputs.environment }}"
```

### Handlebars template snippet (updated deploymentSetupGuide.hbs)

The current `deploymentSetupGuide.hbs` partial at `/src/templates/partials/deploymentSetupGuide.hbs` renders a massive YAML block with 4 separate `donedgardo/build-reporter@v1` calls. It must be replaced to render the ~30-line consolidated snippet above, with `{{#each environments}}` still rendering the environment options list.

The JavaScript `copyDeployWorkflow()` function in the partial must also be updated to copy the new shorter workflow text.

---

## State of the Art

| Old Approach                                                                  | Current Approach                                         | When Changed | Impact                                                        |
| ----------------------------------------------------------------------------- | -------------------------------------------------------- | ------------ | ------------------------------------------------------------- |
| 4 separate action steps (deploying, deployed, error, cancelled) per workflow  | Single action invocation + post step                     | Phase 5      | User workflow goes from ~30 status-reporting lines to 6 lines |
| Generic copy-paste instructions                                               | Pre-filled snippet with service ID                       | Phase 5      | Zero-lookup onboarding                                        |
| `action: update-status` + `status: deploying/deployed/error/cancelled` inputs | `environment` input only; outcome auto-detected          | Phase 5      | Simpler action contract                                       |
| No submodule (YAML has no reference to action repo)                           | `github-action/` submodule = `donedgardo/build-reporter` | Already done | Enables coordinated development                               |

**Current status of `donedgardo/build-reporter`:** Already published at `@v1` on GitHub Marketplace. The submodule is already initialized in launchpad (commit `ed1b8882`). The existing action has `action: "report-build" | "update-status"` and requires `status` as an explicit input. The new phase redesigns this contract.

---

## Open Questions

1. **`GITHUB_JOB_STATUS` availability in post scripts**

   - What we know: Status check functions (`success()`, `failure()`, `cancelled()`) work in `post-if` in `action.yml`. Community reports show `process.env.GITHUB_JOB_STATUS` is available in post script Node.js process.
   - What's unclear: This isn't in official GitHub Actions environment variables docs. It may be version-dependent on the runner.
   - Recommendation: Implement with `GITHUB_JOB_STATUS` as primary mechanism. Add fallback: if the variable is missing, use `core.saveState("main_succeeded", "true")` from the main step so the post step can distinguish "main ran successfully" from "main was skipped or failed." The post step infers: if `main_succeeded === "true"` AND the whole job succeeded (indistinguishable from partial success) → report `deployed`; if `main_succeeded === "true"` AND some later step failed → can't distinguish without `GITHUB_JOB_STATUS`. Validate this in a real GitHub Actions run during Wave 0/1.

2. **Backwards compatibility of action inputs**

   - What we know: The current `donedgardo/build-reporter@v1` is already in use in launchpad's own deploy workflows (`.github/workflows/deploy.yml`, test workflows). Changing the action contract requires updating those workflows too.
   - What's unclear: Whether to keep `action: "report-build"` as a separate mode or collapse everything.
   - Recommendation: Keep `action: "report-build"` for the CI build-reporting step. Add a new "deploy" mode that's the simplified one-shot form. OR remove `action` entirely and use the presence/absence of `environment` input to distinguish: if `environment` is set, this is a deploy action; if not, it's a build-report action. This approach requires updating existing workflows.

3. **Submodule update workflow**
   - What we know: After publishing a new release to `donedgardo/build-reporter`, the launchpad repo's `github-action/` submodule pointer must be updated.
   - What's unclear: Whether to automate this (via a CI step in launchpad that runs `git submodule update --remote`) or do it manually per release.
   - Recommendation: Automate with a simple GitHub Actions workflow in launchpad that runs on a schedule or dispatch to bump the submodule pointer.

---

## Validation Architecture

### Test Framework

| Property           | Value                                                           |
| ------------------ | --------------------------------------------------------------- |
| Framework          | Vitest 1.x (launchpad) + Vitest 1.4.0 (github-action submodule) |
| Config file        | `vitest.config.ts` at repo root (excludes `src/tests/`, `e2e/`) |
| Quick run command  | `yarn test` (runs vitest --run)                                 |
| Full suite command | `yarn test`                                                     |
| Estimated runtime  | ~15-30 seconds                                                  |

### Phase Requirements → Test Map

Phase 5 has no formal REQ-XX IDs, but the behaviors to verify are:

| Behavior                                                              | Test Type | Automated Command               | File Exists?                                           |
| --------------------------------------------------------------------- | --------- | ------------------------------- | ------------------------------------------------------ |
| Action's main step reports `deploying` status via API                 | unit      | `cd github-action && yarn test` | partial (index.test.ts exists, but tests old contract) |
| Action's post step reports `deployed` when job succeeds               | unit      | `cd github-action && yarn test` | ❌ post.test.ts needed                                 |
| Action's post step reports `error` when job fails                     | unit      | `cd github-action && yarn test` | ❌ post.test.ts needed                                 |
| Action's post step reports `cancelled` when job is cancelled          | unit      | `cd github-action && yarn test` | ❌ post.test.ts needed                                 |
| Settings page renders consolidated snippet with service ID pre-filled | unit      | `yarn test`                     | ❌ new test needed in settings.test.ts                 |
| Settings page snippet copy button works with new format               | manual    | n/a                             | n/a                                                    |
| Created-service page snippet shows new consolidated format            | unit      | `yarn test`                     | ❌ new test in services/index.test.ts                  |

### Nyquist Sampling Rate

- **Minimum sample interval:** After every committed task → run: `yarn test`
- **Full suite trigger:** Before merging final task
- **Phase-complete gate:** Full suite green before verification
- **Estimated feedback latency per task:** ~20 seconds

### Wave 0 Gaps

- [ ] `github-action/src/post.ts` — covers post-step outcome detection (create before implementing)
- [ ] `github-action/src/post.test.ts` — unit tests for post step (success/failure/cancelled paths)
- [ ] Update `github-action/src/index.test.ts` — update mocks for new action contract (`environment` input, `saveState` calls)
- [ ] Update `src/server/routes/services/settings.test.ts` — add test that verifies settings page renders consolidated snippet

---

## Sources

### Primary (HIGH confidence)

- Official GitHub Actions metadata syntax docs — `post:` and `post-if:` fields: https://docs.github.com/en/actions/sharing-automations/creating-actions/metadata-syntax-for-github-actions#post
- `@actions/core` npm package — `saveState()`/`getState()` API (official toolkit)
- Official GitHub Actions Marketplace publishing docs: https://docs.github.com/en/actions/sharing-automations/creating-actions/publishing-actions-in-github-marketplace
- Project codebase: existing `github-action/action.yml`, `github-action/src/index.ts`, `.github/workflows/deploy.yml`, `src/templates/partials/deploymentSetupGuide.hbs`, `src/server/routes/services/settings.ts`

### Secondary (MEDIUM confidence)

- GitHub community discussion on `post:` status detection in JavaScript actions: https://github.com/orgs/community/discussions/44245 — confirms `GITHUB_JOB_STATUS` as env var approach; multiple users corroborate
- `@actions/core` saveState/getState pattern for main→post communication: confirmed in actions/toolkit README and multiple community examples

### Tertiary (LOW confidence)

- `GITHUB_JOB_STATUS` as a process environment variable in post scripts — observed in community but not in official env var list. Needs validation against a real runner before relying on it exclusively.

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all libraries already in use or standard toolkit
- Architecture (post step pattern): MEDIUM — core mechanism confirmed from docs; `GITHUB_JOB_STATUS` env var availability in post scripts is community-confirmed but not officially documented
- Dashboard template changes: HIGH — straightforward Handlebars partial update following existing patterns
- Pitfalls: HIGH — derived from codebase inspection and confirmed community gotchas

**Research date:** 2026-02-26
**Valid until:** 2026-03-26 (GitHub Actions metadata syntax is stable; runner env var availability could change on shorter notice)
