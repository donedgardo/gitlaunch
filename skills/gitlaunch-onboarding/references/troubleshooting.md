# Troubleshooting

## Fetching snippets

**`401 Invalid API key`** — the key is wrong, revoked, or from another account.
Do not retry with variations. Ask the user to mint a new one at
`<host>/settings/api-keys`.

**`403 Insufficient scope`** — the key predates the setup-snippets endpoint and
lacks `services:read`. Keys minted during onboarding now carry it; older ones do
not. A new key from settings will work.

**`403` on every call, key looks like `pk_…`** — publishable keys can only
evaluate feature flags. Note that keys minted before the `sk_`/`pk_` split also
start with `pk_` but _are_ secret keys, so the prefix alone does not tell you.
If a `pk_` key 403s on `services:read`, it is genuinely publishable; get a secret
key instead.

**`404 Service not found`** — wrong service ID, or the key belongs to a different
account than the service. Both look identical from outside; have the user
re-copy both values from the same onboarding page.

## Binding the deploy provider

**`409` with `installRequired: true`** — the account has no GitLaunch GitHub App
installation. There is no API to install a GitHub App on someone's behalf; it is
a consent screen on github.com. Send the user to `<host>/settings` to install it,
then re-run the one `POST .../deployment` call. Nothing else needs redoing.

**`404 … is not accessible by the GitLaunch GitHub App installation`** — the App
is installed but was not granted this repository. The user picks repositories
when installing; they can add one later under GitHub → Settings → Applications →
GitLaunch → Configure.

**`400 workflowFile must be a bare .yml filename`** — pass `deploy.yml`, not a
path. GitLaunch stores the filename and GitHub resolves it inside
`.github/workflows/`.

**`403` with `upgradeRequired: true`** — a plan limit, not a wiring problem.
Free allows 3 repositories and public repos only.

## Builds not appearing

Work down this list:

1. **Did CI actually run?** `gh run list --limit 5`.
2. **Did the report step run?** It is guarded on the repo's default branch. On a
   PR branch it is skipped by design. This is the single most common cause.
3. **Is the guard naming the right branch?** The snippet is generated with the
   default branch GitLaunch has on record for the repo. If that record is stale
   or absent it falls back to `main`, and a repo whose default branch is
   `master`, `develop` or `trunk` will never match. Fix it in GitLaunch —
   reconnect the repository — and re-fetch `/setup-snippets`, rather than
   hand-editing the workflow so the two drift apart.
4. **Is `GITLAUNCH_SERVICE_ID` set as a repo _variable_?** If it is missing, the
   URL collapses to `/api/v1/services//builds` and 404s.
5. **Is `GITLAUNCH_API_KEY` set as a repo _secret_?** If missing, the header is
   `Bearer ` and the call 401s.
6. **Is `jq` on the runner?** Standard `ubuntu-latest` has it; slim containers
   and some self-hosted runners do not. The failure is
   `jq: command not found` and an empty `-d`, so GitLaunch answers `400`.
   Either install it in a step before the report
   (`apt-get update && apt-get install -y jq`, or `apk add --no-cache jq`), or
   drop the commit message and hand-build the JSON the way the Jenkins and
   `raw` snippets do:

   ```bash
   -d "{\"buildId\":\"$COMMIT_SHA\",\"commitAt\":\"$COMMIT_AT\"}"
   ```

   `jq` is only there to quote the commit message safely — a message containing
   a quote or a newline would otherwise produce invalid JSON. Keep the
   `commitAt` field either way; without it lead time is measured from when
   GitLaunch first heard about the build, not from the commit.

Check what GitLaunch received:

```bash
curl --fail-with-body -sS "<host>/api/v1/services/<serviceId>/builds" \
  -H "Authorization: Bearer <apiKey>"
```

Note that secrets are not available to workflows triggered by `pull_request`
from a **fork**. Build reporting from fork PRs will not work, and should not —
that is GitHub protecting the key.

## `422 Unexpected inputs provided` when deploying

GitLaunch dispatched the workflow and GitHub refused it. The workflow's
`workflow_dispatch` inputs do not match what GitLaunch sends.

GitLaunch always sends exactly:

```json
{ "environment": "<env>", "buildId": "<sha>" }
```

The workflow must declare exactly `environment` and `buildId`. Not `env`, not
`target`, not extra required inputs. Fix by renaming the inputs, or by adding a
wrapper workflow (see `github-actions.md`).

## Deploy never starts

- **Is the workflow on the default branch?** GitHub only permits
  `workflow_dispatch` for workflows present on the default branch. A deploy
  workflow that exists only on an unmerged PR branch cannot be dispatched. This
  is expected before the integration PR is merged.
- **Is the filename in GitLaunch right?** The service's deployment config stores
  a workflow _filename_ (`deploy.yml`). A rename breaks it.
- **Is the GitHub App still installed** on the repo, with access to it? Check
  `<host>/settings` and GitHub's installed-apps page.

## Build stuck on "deploying"

The deploy started and never reported a terminal status. Causes:

- The workflow failed before reaching its `if: failure()` step — check the run
  logs; a failure during `actions/checkout` happens before any reporting step.
- A status curl failed silently. All snippets use `--fail-with-body`; if one was
  edited to drop that, errors vanish.
- The job was cancelled and there is no `if: cancelled()` step.

All three terminal statuses must be present. `if: success()` alone is not
enough — GitHub skips it on failure, and nothing reports.

You can unstick a build by hand:

```bash
curl --fail-with-body -sS -X PATCH \
  "<host>/api/v1/services/<serviceId>/builds/<buildId>/deploy/<environment>" \
  -H "Authorization: Bearer <apiKey>" \
  -H "Content-Type: application/json" \
  -d '{"status":"error"}'
```

## Wrong code deployed

The deploy workflow must check out `buildId`, not branch tip:

```yaml
- uses: actions/checkout@v4
  with:
    ref: "${{ env.BUILD_ID }}"
```

Without this, redeploying an older build from the dashboard deploys whatever is
currently on `main` — the dashboard says one thing and the servers run another.
Verify this line survived any edits.

## Environment name mismatch

`400 Invalid environment` means the environment in the deploy URL is not one of
the service's environments. The service defines its own (`staging`, `prod` by
default) — they are not a fixed set. List them:

```bash
curl --fail-with-body -sS "<host>/api/v1/services/<serviceId>/environments" \
  -H "Authorization: Bearer <apiKey>"
```

The `options:` list in the deploy workflow must match these names exactly. If the
user adds an environment in GitLaunch later, the workflow needs updating too.

## Plan limits

`403` with `upgradeRequired` on environment creation means the account hit its
plan cap (Free: 2 environments, 3 services, public repos only). Nothing is wrong
with the integration; the user needs to upgrade or reuse an existing environment.
