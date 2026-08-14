# GitHub Actions

Two workflows make a repo fully GitLaunch-enabled:

1. **A build workflow** that runs on pushes and ends by reporting the build.
2. **`.github/workflows/deploy.yml`**, which GitLaunch dispatches.

Fetch both GitLaunch-specific pieces from `/setup-snippets`. Everything on this
page is about the _surrounding_ workflow you wrap them in.

## Case A — creating a build workflow

Skeleton. Replace the install/build/test steps with what you actually detected;
keep the final step exactly as the API returned it.

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # ---- stack-specific: replace ----
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: yarn
      - run: yarn install --frozen-lockfile
      - run: yarn test
      - run: yarn build
      # ---- end stack-specific ----

      # buildReport.github from /setup-snippets, verbatim
      - name: Report build to GitLaunch
        if: github.ref == 'refs/heads/main'
        ...
```

Notes:

- The report step is **last**, so a failing build does not register as a build.
- The `if:` guard must name the repo's real default branch.
- If the workflow has several jobs, put the report in the one that finishes last,
  or add a small `needs:`-gated job that only reports.

### Per-stack setup steps

| Stack  | Setup                                                                                 |
| ------ | ------------------------------------------------------------------------------------- |
| Node   | `actions/setup-node@v4` with `node-version` and `cache`                               |
| Python | `actions/setup-python@v5`, then `pip install -r requirements.txt` or `poetry install` |
| Go     | `actions/setup-go@v5` with `go-version`                                               |
| Rust   | `dtolnay/rust-toolchain@stable`, plus `Swatinem/rust-cache@v2`                        |
| Java   | `actions/setup-java@v4` with `distribution: temurin`                                  |
| .NET   | `actions/setup-dotnet@v4`                                                             |
| Ruby   | `ruby/setup-ruby@v1` with `bundler-cache: true`                                       |
| Docker | `docker/setup-buildx-action@v3`, `docker/build-push-action@v6`                        |

Pin to the major version tags above; do not invent versions you are unsure of.

## Case B — grafting onto an existing workflow

Find the workflow that actually represents a build of the default branch:

```bash
ls .github/workflows/
grep -l "branches:" .github/workflows/*.yml
gh workflow list          # shows which are active
gh run list --limit 10    # shows which actually run
```

Pick the one that runs on push to the default branch and does real work. If two
qualify, ask the user.

Then append the report step to the **last job** in that workflow. If jobs run in
parallel, add a dedicated final job instead:

```yaml
report-build:
  needs: [test, build] # every job that must succeed first
  if: github.ref == 'refs/heads/main'
  runs-on: ubuntu-latest
  steps:
    # buildReport.github from /setup-snippets
```

Note the snippet already carries its own `if:` guard. If you put it in a job that
is itself guarded, keep only one guard — a duplicated condition is harmless but
confusing.

`jq` is present on `ubuntu-latest`. On a self-hosted or container runner it may
not be; if the runner is not a standard GitHub-hosted image, either install `jq`
or use the `raw` snippet's simpler payload.

## The deploy workflow

Write `deploy.github` to `.github/workflows/deploy.yml` unchanged, except for the
placeholder deploy step:

```yaml
- name: Deploy
  run: echo "Deploying $BUILD_ID to $ENVIRONMENT"
```

Replace it only if the repo tells you how it deploys — a `fly.toml`, a
`vercel.json`, a `Procfile`, an existing deploy script, a Helm chart, a
`docker-compose.prod.yml`. If you cannot tell, **leave it** and say so in the PR
body. `$ENVIRONMENT` and `$BUILD_ID` are already in scope for whatever you write.

### If a deploy workflow already exists

Do not overwrite it. Instead:

1. Add the three status `curl` calls from the snippet — `deploying` at the start,
   then `deployed` / `error` / `cancelled` guarded by `if: success()`,
   `if: failure()`, `if: cancelled()`.
2. Reconcile its `workflow_dispatch` inputs with the contract: exactly
   `environment` and `buildId`. This is the part most likely to break. If the
   existing workflow takes different inputs (`env`, `target`, `version`, `tag`),
   you must either rename them or add a thin wrapper workflow that GitLaunch
   dispatches and which then calls the real one via `workflow_call`.

A wrapper looks like this:

```yaml
name: Deploy (GitLaunch)
on:
  workflow_dispatch:
    inputs:
      environment: { required: true, type: choice, options: [staging, prod] }
      buildId: { required: false, type: string }
jobs:
  call:
    uses: ./.github/workflows/existing-deploy.yml
    with:
      target: ${{ inputs.environment }}
      version: ${{ inputs.buildId }}
    secrets: inherit
```

Prefer the wrapper when the existing workflow is shared or triggered by humans —
renaming its inputs would break their habits and any other automation.

## Auto-deploy on green build

If the user wants every successful build deployed to staging automatically, add
this job to the build workflow rather than a separate trigger:

```yaml
deploy-staging:
  needs: [build]
  if: github.ref == 'refs/heads/main'
  uses: ./.github/workflows/deploy.yml
  with:
    environment: staging
    buildId: ${{ github.sha }}
  secrets: inherit
```

Only add this if asked. Deploying on every merge is a policy decision, not a
default.

## Permissions

The deploy workflow needs no special `permissions:` block for GitLaunch itself —
it only makes outbound curl calls. It may need permissions for _your_ deploy
(e.g. `id-token: write` for OIDC to a cloud provider). Add those only if the
deploy step you wrote requires them.
