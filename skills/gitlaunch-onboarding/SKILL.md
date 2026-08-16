---
name: gitlaunch-onboarding
description: Wire a repository up to GitLaunch — detect the project and its CI/CD, then open a PR that either creates pipelines with GitLaunch build reporting and deploy control built in, or integrates GitLaunch into the pipelines already there. Use when the user asks to set up, connect, integrate or onboard GitLaunch, or pastes a GitLaunch service ID and API key.
metadata:
  author: GitLaunch
  version: 1.0.0
---

# GitLaunch — repository onboarding

GitLaunch gives a team a deploy dashboard: CI reports **builds**, and GitLaunch
dispatches **deploys** of a chosen build to a chosen environment, tracking status
along the way. Your job is to make a repository speak that protocol, and to
deliver it as a pull request the user reviews — never as commits pushed to their
default branch.

Most users arriving here do **not** have working CI/CD. Assume nothing.

## What you need before starting

Three values, normally pasted from the GitLaunch onboarding page:

| Value          | Looks like                 | Notes                                        |
| -------------- | -------------------------- | -------------------------------------------- |
| Service ID     | `6f2a1b3c4d5e6f7a8b9c0d1e` | 24-char hex                                  |
| API key        | `sk_acme_xxxxxxxx…`        | Shown **once**. Some older keys start `pk_`. |
| GitLaunch host | `https://gitlaunch.dev`    | Different for self-hosted                    |

If any are missing, ask for them. **Never invent, guess, or reuse a key from
another project.** If the user has lost the key, send them to
`<host>/settings/api-keys` to mint a new one rather than guessing.

## Hard rules

1. **The API key is a secret.** It goes in a GitHub Actions _secret_, a Jenkins
   _credential_, or the CI system's secret store. It must never be written into
   a workflow file, a repo _variable_, an `.env` that is committed, or a commit
   message. If you catch yourself about to write the literal key into a tracked
   file, stop.
2. **Never push to the default branch.** Work on a branch and open a PR.
3. **Read a file immediately before you edit it.** Existing pipelines are the
   user's, not yours.
4. **Minimal diff.** Add GitLaunch reporting. Do not reformat, upgrade actions,
   restructure jobs, or "improve" anything you were not asked to touch.
5. **Refuse to guess.** If detection is ambiguous — several projects in a
   monorepo, two plausible deploy pipelines, no clear default branch — list what
   you found and ask the user to choose. Do not pick for them.
6. **Fetch the snippets; do not write them from memory.** See below.

## Step 1 — Fetch the canonical snippets

GitLaunch serves the exact YAML for this service. It is templated with the
service's real environments, so it will not match whatever you remember.

```bash
curl --fail-with-body -sS \
  "<host>/api/v1/services/<serviceId>/setup-snippets" \
  -H "Authorization: Bearer <apiKey>"
```

Returns:

```jsonc
{
  "secrets": {
    "secretName": "GITLAUNCH_API_KEY",
    "variableName": "GITLAUNCH_SERVICE_ID",
    "serviceId": "…",
  },
  "buildReport": { "github": "…", "jenkins": "…", "raw": "…" },
  "deploy": { "github": "…", "githubPath": ".github/workflows/deploy.yml" },
}
```

Use these strings verbatim as the GitLaunch-specific parts of what you write.
You still adapt the _surrounding_ workflow (build steps, triggers, runner) to
the project.

`buildReport.github` already carries the branch guard for this service — the
`if:` names the default branch GitLaunch has on record for the repo, not a
hardcoded `main`. Do not retune it. If it disagrees with the branch you detect
in Step 2, GitLaunch's record is what is wrong; say so and ask the user rather
than editing the snippet.

- `401` — the key is wrong or revoked. Ask for a fresh one; do not retry.
- `403` — the key lacks `services:read`. It was minted before this feature; ask
  the user to create a new key at `<host>/settings/api-keys`.
- `404` — wrong service ID, or the key belongs to a different account.

## Step 2 — Detect the project

Establish, from the repo itself:

- **Language and package manager** — infer from lockfiles, never from the
  presence of a manifest alone (`yarn.lock` → yarn, `pnpm-lock.yaml` → pnpm,
  `package-lock.json` → npm, `poetry.lock` → poetry, `go.sum` → go modules, …).
- **Build and test commands** — read them out of `package.json` scripts,
  `Makefile`, `pyproject.toml`, `Cargo.toml`. Do not assume `npm run build`
  exists.
- **The default branch** — `git symbolic-ref refs/remotes/origin/HEAD` or
  `gh repo view --json defaultBranchRef`. GitLaunch dispatches against it, so
  this matters (see Step 5).
- **Monorepo?** If there are multiple deployable apps, ask which one this
  service represents before writing anything.

See `references/detection.md` for the full signal table.

## Step 3 — Detect existing CI/CD

Look for, in order:

| System                     | Evidence                                   |
| -------------------------- | ------------------------------------------ |
| GitHub Actions             | `.github/workflows/*.yml`                  |
| Jenkins                    | `Jenkinsfile`, `jenkins/`                  |
| GitLab CI                  | `.gitlab-ci.yml`                           |
| CircleCI                   | `.circleci/config.yml`                     |
| Travis / Drone / Buildkite | `.travis.yml`, `.drone.yml`, `.buildkite/` |

Then classify the repo into exactly one of three cases and say which you picked
and why before you edit anything.

### Case A — No CI/CD at all

Create it. The user gets a build pipeline **and** GitLaunch deploy control in
one PR.

- Write a build/test workflow appropriate to the detected stack, ending with the
  `buildReport.github` step so every green build on the default branch registers
  with GitLaunch.
- Write `deploy.github` to `deploy.githubPath`, replacing its placeholder
  `Deploy` step with a real one if — and only if — you can tell how this project
  deploys. If you cannot, **leave the placeholder and say so in the PR body**. A
  wrong deploy step is far worse than an honest `TODO`.

Details and per-stack build workflows: `references/github-actions.md`.

### Case B — GitHub Actions already present

Integrate, do not replace.

- Find the workflow that runs on pushes to the default branch and represents a
  successful build. Append the `buildReport.github` step to its final job. If
  several qualify, ask.
- Add `deploy.github` as a **new** file at `deploy.githubPath`. If a deploy
  workflow already exists, do not overwrite it — instead add the three status
  `curl` calls from the snippet into the existing job and keep its own inputs,
  then reconcile with the input contract in Step 4.

### Case C — CI/CD exists, but not GitHub Actions

Jenkins, GitLab, CircleCI, and anything else report builds over plain HTTP.

- Add the matching `buildReport.*` snippet to the existing pipeline.
- For **deploy control**, GitLaunch needs a way to trigger the deploy. Jenkins is
  supported natively (job name); everything else uses the `raw` provider, where
  GitLaunch POSTs `{ buildId, environment }` to a webhook URL you must set up.
  Explain this and let the user choose; do not attempt to build a webhook
  receiver for them.

See `references/other-ci.md`.

## Step 4 — The deploy input contract (this one bites)

If the repo uses GitHub Actions, the deploy workflow **must** declare exactly
these two `workflow_dispatch` inputs:

```yaml
on:
  workflow_dispatch:
    inputs:
      environment: { required: true, type: choice, options: [...] }
      buildId: { required: false, type: string }
```

GitLaunch dispatches with `inputs: { environment, buildId }` and nothing else.
GitHub rejects the **entire dispatch** with `422 Unexpected inputs provided` if
the workflow declares an input GitLaunch does not send, or receives one it does
not declare. When integrating into an existing deploy workflow that already has
its own inputs, this is the single most likely thing to break — flag it
explicitly in the PR body.

Statuses reported back must be exactly `deploying`, `deployed`, `error`,
`cancelled`. Every terminal outcome must report one, or the build sticks on
"deploying" in the dashboard forever.

## Step 5 — Repo configuration

Two values must exist in the repository:

- Secret `GITLAUNCH_API_KEY` — the API key
- Variable `GITLAUNCH_SERVICE_ID` — the service ID

If the `gh` CLI is authenticated, offer to set them:

```bash
gh secret set GITLAUNCH_API_KEY --body "<apiKey>"
gh variable set GITLAUNCH_SERVICE_ID --body "<serviceId>"
```

Ask before running these — they write to the user's GitHub repo. If `gh` is not
available, print the exact values and the settings URL and let the user do it.
Note that secrets set this way are repo-level; a repo using environments may
need them set per environment instead.

**Tell the user this:** GitHub only allows `workflow_dispatch` for workflows that
exist on the **default branch**. Until this PR is merged, GitLaunch cannot
dispatch the deploy — the button will fail. Build reporting, by contrast, starts
working as soon as CI runs on the branch. Put this in the PR body.

## Step 6 — Bind the deploy provider

GitLaunch needs to know _what to trigger_ when someone clicks deploy. You can
set this yourself:

```bash
curl --fail-with-body -sS -X POST \
  "<host>/api/v1/services/<serviceId>/deployment" \
  -H "Authorization: Bearer <apiKey>" \
  -H "Content-Type: application/json" \
  -d '{"provider":"github","repository":"<owner>/<repo>","workflowFile":"deploy.yml"}'
```

`repository` is the `owner/repo` you already know from the checkout —
`gh repo view --json nameWithOwner -q .nameWithOwner`, or parse
`git remote get-url origin`. GitLaunch registers the repository for the account
if it is not registered already, so there is no separate repo-selection step.

Other providers:

```jsonc
{ "provider": "jenkins", "jobName": "deploy-api" }
{ "provider": "raw",     "endpointUrl": "https://deploy.example.com/hook" }
```

Responses worth handling:

- **`409` with `installRequired: true`** — the account has no GitLaunch GitHub
  App installation. This is the one step that genuinely cannot be done from
  here: installing a GitHub App is a consent screen on github.com with no API
  equivalent. Tell the user to install it at `<host>/settings`, then re-run this
  one command. Do not treat it as a failure of the integration — everything else
  you wrote is still correct.
- **`409` on Jenkins** — no Jenkins server is connected; point the user at
  `<host>/settings/jenkins`.
- **`404`** — the App is installed but cannot see this repository. The user must
  grant it access to the repo in their GitHub App settings.
- **`403` with `upgradeRequired: true`** — the account hit a plan limit (repo
  count, or a private repo on a public-only plan). Report it plainly; do not
  retry.

If the user only wants build reporting for now, skip this step. A service with
builds and no deploy binding is a valid state — GitLaunch shows the builds and
the deploy button simply is not wired yet.

## Step 7 — Open the PR

```bash
git checkout -b gitlaunch-integration
# … write files …
git add -A && git commit -m "ci: report builds and deploys to GitLaunch"
git push -u origin gitlaunch-integration
gh pr create --title "Integrate GitLaunch" --body "…"
```

Before committing, run `git diff --cached` and confirm the API key does not
appear anywhere in it.

The PR body should state: which case you detected, which files you added or
changed, whether the deploy step is real or a placeholder, that the secret and
variable must be set (or that you set them), and the default-branch caveat from
Step 5.

## Step 8 — Verify

Onboarding step 2 in the GitLaunch UI advances by itself the moment the first
build lands, so the honest verification is a real CI run.

- If CI runs on the PR branch and the report step is reachable there, the build
  appears in GitLaunch within seconds. Confirm with:

  ```bash
  curl --fail-with-body -sS "<host>/api/v1/services/<serviceId>/builds" \
    -H "Authorization: Bearer <apiKey>"
  ```

- If the report step is gated to the default branch (the snippet's default),
  it will not fire until merge. Say so rather than implying success.

Do not report the integration as working because the YAML looks right. Either
the build shows up in GitLaunch or it does not.

## Reference files

- `references/detection.md` — project type, package manager and CI detection signals
- `references/github-actions.md` — build workflows per stack, and how to graft onto an existing one
- `references/other-ci.md` — Jenkins, GitLab CI, CircleCI, and the `raw` deploy provider
- `references/troubleshooting.md` — 401/403/422, builds not appearing, stuck "deploying"

## Status

Report progress with `[STATUS]` messages: `Detected <stack>`, `No CI/CD found`,
`Integrating with GitHub Actions`, `PR opened`.

Report blocked states with `[ABORT]`:

- `Missing service ID or API key`
- `Ambiguous project — user must choose`
- `Not a git repository`
