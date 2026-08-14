# Jenkins, GitLab CI, CircleCI, and everything else

Build reporting is just an HTTP POST, so every CI system can do it. Deploy
_control_ is the part that differs, because GitLaunch has to trigger something.

## How GitLaunch triggers a deploy

| Provider  | How                                    | Configured in the UI as        |
| --------- | -------------------------------------- | ------------------------------ |
| `github`  | `workflow_dispatch` on a workflow file | repository + workflow filename |
| `jenkins` | `buildWithParameters` on a job         | job name                       |
| `raw`     | HTTP POST to a URL you own             | endpoint URL                   |

The provider is bound in the GitLaunch web UI (onboarding step 3, or the
service's settings page) — **not** from this skill and not over the API. Your job
is to make the repo ready and tell the user which option to pick.

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

Build reporting — add a job to `.gitlab-ci.yml` using the `raw` snippet:

```yaml
report-build:
  stage: .post
  image: curlimages/curl:latest
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  script:
    - |
      curl --fail-with-body -sS -X POST \
        "<host>/api/v1/services/<serviceId>/builds" \
        -H "Authorization: Bearer $GITLAUNCH_API_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"buildId\":\"$CI_COMMIT_SHA\"}"
```

Set `GITLAUNCH_API_KEY` as a **masked, protected** CI/CD variable in
Settings → CI/CD → Variables.

Deploy control uses the `raw` provider — see below.

## CircleCI

```yaml
jobs:
  report-build:
    docker:
      - image: cimg/base:stable
    steps:
      - run:
          name: Report build to GitLaunch
          command: |
            curl --fail-with-body -sS -X POST \
              "<host>/api/v1/services/<serviceId>/builds" \
              -H "Authorization: Bearer $GITLAUNCH_API_KEY" \
              -H "Content-Type: application/json" \
              -d "{\"buildId\":\"$CIRCLE_SHA1\"}"

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
