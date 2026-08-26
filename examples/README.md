# Examples

Throwaway projects for exercising the [`gitlaunch-onboarding`](../skills/gitlaunch-onboarding/SKILL.md)
skill — the agent flow offered on onboarding step 2, where a customer's coding
agent wires their repo up to GitLaunch and opens a PR.

These are fixtures, not products. Nothing here is shipped or imported by the app.

| Example              | Stack                            | Exercises                                    |
| -------------------- | -------------------------------- | -------------------------------------------- |
| `dummy-react-app`    | Vite + React + TS, npm, vitest   | Case A — a repo with no CI/CD                |
| `dummy-rust-service` | Rust, cargo, four GitHub Actions | Case B — integrate with an existing pipeline |

## Running a test round

```bash
./examples/new-sandbox.sh dummy-react-app --push <owner>/gl-sandbox-react
./examples/new-sandbox.sh dummy-rust-service --push <owner>/gl-sandbox-rust
```

That copies the example (minus `node_modules`/`dist`/`target`) into a temp
directory, makes it a git repo on `main`, and creates a private GitHub repo with
it. Drop `--push` to stay local — enough to test detection and file writing, but
`gh pr create` and the deploy binding need a real remote.

Then, in GitLaunch: create a service, mint an API key, and copy the prompt from
onboarding step 2. Run your coding agent in the sandbox directory with that
prompt and let it work.

### Step 6 against a local instance

A local GitLaunch run with `USE_FAKE_GITHUB=true` has a fake GitHub App
installation that can only see a fixed repository list —
`test-org/public-repo-1`, `test-org/public-repo-2`, `test-org/private-repo`
(`src/services/github/fakes.ts`). Binding the deploy provider to the sandbox repo
you just created therefore fails, and it is meant to:

- `donedgardo/gl-sandbox-rust` → `404 … is not accessible by the GitLaunch GitHub App installation`
- `test-org/private-repo` → `403 {"upgradeRequired":true}` (private repo, free plan)
- `test-org/public-repo-1` → `200`

The 404 is the correct answer to a repo the installation cannot see, not a broken
step — the agent should report it as such and move on. Bind
`test-org/public-repo-1` if you want to watch the success path. To bind the real
sandbox repo, run against an instance with real GitHub App credentials.

## What a correct run looks like

### `dummy-react-app` — Case A (no `.github/`, no `Jenkinsfile`, nothing)

- [ ] Says it detected **Case A** and why, before editing anything
- [ ] Detects **npm** from `package-lock.json` — not yarn, not pnpm
- [ ] Uses the real scripts: `npm ci`, `npm test`, `npm run build`. There is no
      `lint` script; a workflow that runs one is invented
- [ ] Fetched `/setup-snippets` rather than writing the YAML from memory
- [ ] A build workflow whose final job ends with the build-report step
- [ ] `deploy.yml` declaring **exactly** `environment` and `buildId` inputs
- [ ] The deploy step left as a **placeholder** — this app's README says only
      "ship `dist/` wherever static files go", which is not enough to know how it
      deploys. Inventing a deploy step here is a failure, not initiative
- [ ] The `if: github.ref == 'refs/heads/main'` guard matches the sandbox's
      default branch (`main`)
- [ ] The API key appears in **no** tracked file — check with
      `git log -p | grep -c '<key prefix>'`
- [ ] A PR, on a branch, never a push to `main`
- [ ] PR body mentions that dispatch only works once merged to the default branch

### `dummy-rust-service` — Case B (GitHub Actions already there)

Four workflows are already committed, and one of them is already called
`deploy.yml` and already deploys the service for real. Nothing here needs
inventing; everything here needs reconciling.

- [ ] Says it detected **Case B** and why, before editing anything
- [ ] Detects **Rust / cargo** from `Cargo.toml` + `Cargo.lock`
- [ ] Picks `ci.yml` as the build workflow and says why the others do not
      qualify: `checks.yml` is pull-request only, `audit.yml` is a scheduled
      `cargo audit` (its `workflow_dispatch` is not a deploy hook), `deploy.yml`
      deploys. Exactly one workflow runs on push to `main`, so this is not an
      "if several qualify, ask" — picking `ci.yml` and explaining is the answer
- [ ] The report step lands in `package`, the job that `needs: [fmt, test]` —
      not in `fmt` or `test`, and not in a new job that reports without them
- [ ] `.github/workflows/deploy.yml` **still deploys this repo**. The snippet's
      `githubPath` is already occupied; writing the snippet there destroys the
      real pipeline and shows up in the diff as deletions
- [ ] The existing inputs `target`, `revision` and `dry_run` survive. GitLaunch
      sends only `environment` and `buildId`, so the two contracts get
      **bridged, not merged**. Leaving `deploy.yml` declaring
      `target`/`revision`/`dry_run` _and_ pointing GitLaunch at it is a
      `422 Unexpected inputs provided` on the first click of the deploy button
- [ ] The bridge is a **wrapper** — a new workflow (e.g.
      `gitlaunch-deploy.yml`) declaring exactly `environment` and `buildId`,
      which calls `deploy.yml` through a `workflow_call:` block added to it and
      maps the inputs across. Renaming `deploy.yml`'s own inputs is the weaker
      answer: this README says on-call runs that form by hand during incidents
      and the names are in the runbook. A rename that ships anyway must also
      update `concurrency: group: deploy-${{ inputs.target }}` and say in the PR
      body that the runbook now lies
- [ ] The Step 6 binding's `workflowFile` names whatever GitLaunch should
      dispatch. If a wrapper was added, binding the default `deploy.yml` is the
      same 422 with extra steps
- [ ] Environment names reconciled. The repo's `target` is a `choice` of
      `staging` / `production`; a GitLaunch service defaults to `staging` /
      `prod`. Passing `prod` straight through fails the choice validation, so it
      is either mapped or the service's environments are renamed to match
- [ ] A terminal status is reported even when the **first** job fails.
      `deploy.yml` has two jobs; an `if: failure()` step inside `upload` never
      runs when `build-artifact` fails, and the dashboard sticks on "deploying"
      forever. A final `if: always()` job keyed off `needs.*.result` is the fix
- [ ] Minimal diff on the existing CI. Still `actions/checkout@v3`, still
      `actions-rs/toolchain@v1` (the skill's own per-stack table recommends
      `dtolnay/rust-toolchain` — swapping it is a hard-rule-4 violation), still
      `ubuntu-22.04`, still `RUSTFLAGS: "-D warnings"`, `--locked` not dropped,
      and no `cargo clippy` step invented — this repo has never run clippy.
      Check with `git diff main -- '.github/workflows/ci.yml'`: additions only
- [ ] **No** placeholder `echo "Deploying …"` step anywhere. Unlike
      `dummy-react-app`, this repo says exactly how it deploys
      (`scripts/deploy.sh`), so a placeholder is a failure to read
- [ ] The API key appears in **no** tracked file
- [ ] A PR, on a branch, never a push to `main`
- [ ] PR body flags the input-contract change and the default-branch caveat

Then verify for real rather than by reading the YAML:

```bash
curl --fail-with-body -sS "<host>/api/v1/services/<serviceId>/builds" \
  -H "Authorization: Bearer <apiKey>"
```

If the report step is gated to `main`, no build appears until the PR merges —
that is correct behaviour, not a failure.

## Cleaning up

```bash
gh repo delete <owner>/gl-sandbox-react --yes
gh repo delete <owner>/gl-sandbox-rust --yes
rm -rf /tmp/gitlaunch-sandbox-*
```

Revoke the API key at `<host>/settings/api-keys` when done — sandbox keys are
real keys.

## Adding an example

One directory per fixture, named for what it is, with a `README.md` that reads
like a normal project README. Keep CI/CD out of it unless the fixture's whole
point is an existing pipeline (Case B or C) — then commit exactly the pipeline
being tested and note it in the table above.
