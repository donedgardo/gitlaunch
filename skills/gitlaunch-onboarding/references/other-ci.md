# Jenkins, GitLab CI, CircleCI, and everything else

Build reporting is just an HTTP POST, so every CI system can do it. Deploy
_control_ is the part that differs, because GitLaunch has to trigger something.

## Always send `commitAt`

Every build report below carries `commitAt` — an ISO-8601 timestamp of when the
commit was authored. DORA lead time is measured from it. Leave it out and
GitLaunch can only measure from the moment the report arrived, which silently
drops however long the change sat waiting for a runner, so a slow queue reads as
fast delivery. `git show -s --format=%cI <sha>` produces it anywhere there is a
checkout.

## How GitLaunch triggers a deploy

| Provider  | How                                    | Configured in the UI as        |
| --------- | -------------------------------------- | ------------------------------ |
| `github`  | `workflow_dispatch` on a workflow file | repository + workflow filename |
| `jenkins` | `buildWithParameters` on a job         | job name                       |
| `raw`     | HTTP POST to a URL you own             | endpoint URL                   |

You bind the provider yourself with `POST /api/v1/services/:serviceId/deployment`
(see Step 6 of the skill). What each provider needs from the _account_ differs,
and that part may still need the user:

- `github` — a GitLaunch GitHub App installation. Browser-only, once per account.
- `jenkins` — a Jenkins connection in settings (server URL, user, API token).
- `raw` — nothing; the endpoint URL is the whole configuration.

So `raw` is the only provider an agent can set up end to end with no browser trip
at all, and `github` needs one the first time an account ever uses it.

## Jenkins

### Build reporting

Add the `buildReport.jenkins` snippet as a stage in the `Jenkinsfile`, after the
build succeeds. It expects a Jenkins credential with ID `gitlaunch-api-key`
(a Secret Text credential holding the API key).

Tell the user to create it: **Manage Jenkins → Credentials → Global → Add
Credentials → Secret text**, ID exactly `gitlaunch-api-key`.

`$GIT_COMMIT` is set by the Git plugin. In a pipeline that checks out manually,
use `sh(returnStdout: true, script: 'git rev-parse HEAD').trim()` instead.

### Deploy control

GitLaunch calls `buildWithParameters` on a named job, passing `environment` and
`buildId`. The job must:

1. Be parameterised with a **String parameter** `environment` and a **String
   parameter** `buildId`.
2. Check out `buildId` rather than branch tip.
3. PATCH the deploy status back at start and on every terminal outcome, exactly
   as the GitHub deploy workflow does.

The account also needs a Jenkins connection configured in GitLaunch settings
(server URL, username, API token) — direct the user to `<host>/settings/jenkins`.

A minimal deploy job:

```groovy
pipeline {
  agent any
  parameters {
    string(name: 'environment', defaultValue: 'staging')
    string(name: 'buildId', defaultValue: '')
  }
  environment {
    DEPLOY_URL = "<host>/api/v1/services/<serviceId>/builds/${params.buildId}/deploy/${params.environment}"
  }
  stages {
    stage('Report deploying') {
      steps {
        withCredentials([string(credentialsId: 'gitlaunch-api-key', variable: 'KEY')]) {
          sh 'curl --fail-with-body -sS -X PATCH "$DEPLOY_URL" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d "{\\"status\\":\\"deploying\\"}"'
        }
      }
    }
    stage('Deploy') {
      steps { echo "deploy ${params.buildId} to ${params.environment}" }
    }
  }
  post {
    success   { /* PATCH "deployed"  */ }
    failure   { /* PATCH "error"     */ }
    aborted   { /* PATCH "cancelled" */ }
  }
}
```

Fill the `post` blocks with the same `withCredentials` + `curl` shape. Every one
of them must fire, or the dashboard stays on "deploying".

## GitLab CI

### Build reporting

Add the `buildReport.gitlab` job from `/setup-snippets` to `.gitlab-ci.yml`,
verbatim. It looks like this (fetch it; do not copy this):

```yaml
report_build:
  stage: .post
  image: alpine:3.20
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  before_script:
    - apk add --no-cache curl jq
  script:
    - |
      curl --fail-with-body -sS -X POST "<host>/api/v1/services/<serviceId>/builds" \
        -H "Authorization: Bearer $GITLAUNCH_API_KEY" \
        -H "Content-Type: application/json" \
        -d "$(jq -nc --arg buildId "$CI_COMMIT_SHA" --arg message "$CI_COMMIT_MESSAGE" --arg commitAt "$CI_COMMIT_TIMESTAMP" '{buildId:$buildId,message:$message,commitAt:$commitAt}')"
```

Three things about it are deliberate, because each was a real first-run failure:

- **Its own image, with `jq` and `curl` installed in `before_script`.**
  `curlimages/curl` has no `jq`; `alpine` has neither until `apk add`. A job
  that assumes a tool exists fails with `jq: not found` on the first pipeline
  and not before.
- **No `git`.** GitLab already exposes the SHA, the message and an ISO-8601
  timestamp (`$CI_COMMIT_TIMESTAMP`) as predefined variables, so the job never
  runs `git show` — which also would not exist on that image.
- **The payload is built by `jq`.** `$CI_COMMIT_MESSAGE` is multi-line; dropping
  it into a JSON literal by hand is rejected by the API with
  `Bad control character in string literal`.

The `.post` stage runs after every other stage, so the job needs no `needs:`
and does not care what the build stages are called. `rules:` keeps it to the
project's own default branch — no branch name to keep in sync.

Set `GITLAUNCH_API_KEY` as a **masked** CI/CD variable in Settings → CI/CD →
Variables. Only mark it _protected_ if the default branch is a protected
branch; a protected variable is invisible to pipelines on unprotected branches,
and the symptom is a `401` with an empty `Bearer` header. The user can set it
in the UI, or you can with `glab variable set GITLAUNCH_API_KEY --masked` if
`glab` is authenticated — ask first, it writes to their project. There is no
need for a `GITLAUNCH_SERVICE_ID` variable: the snippet carries the service id.

### Deploy control

Uses the `raw` provider — see below. GitLab's own trigger API
(`POST /projects/<id>/trigger/pipeline`) does not accept GitLaunch's payload
shape, so there is a relay in between that the user owns.

## CircleCI

```yaml
jobs:
  report-build:
    docker:
      - image: cimg/base:stable
    steps:
      - checkout
      - run:
          name: Report build to GitLaunch
          command: |
            COMMIT_AT="$(git show -s --format=%cI $CIRCLE_SHA1)"
            curl --fail-with-body -sS -X POST \
              "<host>/api/v1/services/<serviceId>/builds" \
              -H "Authorization: Bearer $GITLAUNCH_API_KEY" \
              -H "Content-Type: application/json" \
              -d "{\"buildId\":\"$CIRCLE_SHA1\",\"commitAt\":\"$COMMIT_AT\"}"

workflows:
  main:
    jobs:
      - build
      - report-build:
          requires: [build]
          filters: { branches: { only: main } }
```

`GITLAUNCH_API_KEY` goes in Project Settings → Environment Variables.

## The `raw` deploy provider

For any CI system GitLaunch cannot trigger directly, the user configures a
**raw endpoint URL**. GitLaunch POSTs to it:

```json
{ "buildId": "<sha>", "environment": "<env>" }
```

Whatever receives that POST is responsible for starting the deploy and for
PATCHing status back to
`<host>/api/v1/services/<serviceId>/builds/<buildId>/deploy/<environment>`.

Common shapes:

- **GitLab**: a pipeline trigger token URL —
  `https://gitlab.com/api/v4/projects/<id>/trigger/pipeline`. The payloads do not
  match, so this usually needs a tiny relay.
- **CircleCI**: the v2 pipeline API, same mismatch.
- **A serverless function** the user owns, translating GitLaunch's payload into
  their CI's trigger API.

**Do not build this relay unless the user asks.** Explain what the endpoint must
accept and let them decide. Writing and hosting a webhook receiver is well
outside "integrate my repo with GitLaunch", and getting it wrong silently breaks
deploys.

If the user is not ready to set up deploy control, that is fine: a service with
build reporting only is a valid, useful state. GitLaunch shows the builds; the
deploy button simply is not wired yet. Say this rather than forcing a choice.
