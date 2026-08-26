/**
 * The canonical CI/CD snippets we hand to customers.
 *
 * This is the single source of truth. The onboarding UI, the per-service
 * settings page and the setup-snippets API all render from here, so an AI
 * agent wiring up a repo and a human copy-pasting from the dashboard cannot
 * drift apart.
 *
 * Three contracts constrain what this may emit, all covered by tests:
 *   1. The deploy workflow must declare exactly the inputs
 *      `MultiTenantGithubDispatchService` sends (`environment`, `buildId`).
 *      GitHub rejects the entire dispatch with 422 on an undeclared input.
 *   2. Reported statuses must come from the golden reporter contract shared
 *      with the github-action submodule.
 *   3. The build-report step's branch guard must name the repo's own default
 *      branch. A guard naming a branch the repo does not have fails silently:
 *      no error, no failed run, no build — just a dashboard that never fills.
 */

export type SetupSnippetsInput = {
  /** Base URL of this GitLaunch instance — self-hosts are not gitlaunch.dev. */
  apiUrl: string;
  serviceId: string;
  /** The service's own environments, in display order. */
  environments: string[];
  /**
   * The default branch of the repo these snippets are for — the build-report
   * step is gated to it. Pass an empty string only when it is genuinely
   * unknowable (see FALLBACK_DEFAULT_BRANCH).
   */
  defaultBranch: string;
};

export type SetupSnippets = {
  secrets: {
    secretName: "GITLAUNCH_API_KEY";
    variableName: "GITLAUNCH_SERVICE_ID";
    serviceId: string;
  };
  buildReport: {
    github: string;
    jenkins: string;
    raw: string;
  };
  deploy: {
    github: string;
    /** Where the deploy workflow must live for GitLaunch to dispatch it. */
    githubPath: string;
  };
};

const DEFAULT_ENVIRONMENT_NAMES = ["staging", "prod"];

/**
 * Used only when nothing can say what the repo's default branch is: a service
 * with no repository bound yet (onboarding creates the service before CD is
 * configured), a Jenkins or raw service that never had one, or a repository
 * record written before GitLaunch started storing the branch. `main` is
 * GitHub's own default for new repos, so it is the best guess available — but
 * it is a guess, and on a `master`/`develop`/`trunk` repo it is wrong.
 */
export const FALLBACK_DEFAULT_BRANCH = "main";

const buildsPath = (serviceId: string) =>
  `/api/v1/services/${serviceId}/builds`;

function githubBuildReport(apiUrl: string, defaultBranch: string): string {
  // Uses vars/secrets rather than the literal service id so the snippet keeps
  // working if the repo is pointed at a different service.
  //
  // `commitAt` is what makes lead time mean commit-to-live. `head_commit` is
  // only populated on a push event, so it falls back to asking git — on a
  // pull_request or a manual run there is no head_commit and an empty string
  // would be rejected.
  return `- name: Report build to GitLaunch
  if: github.ref == 'refs/heads/${defaultBranch}'
  env:
    GITLAUNCH_COMMIT_MESSAGE: \${{ github.event.head_commit.message }}
    GITLAUNCH_COMMIT_AT: \${{ github.event.head_commit.timestamp }}
  run: |
    COMMIT_AT="\${GITLAUNCH_COMMIT_AT:-$(git show -s --format=%cI \${{ github.sha }})}"
    curl --fail-with-body -sS -X POST \\
      "${apiUrl}/api/v1/services/\${{ vars.GITLAUNCH_SERVICE_ID }}/builds" \\
      -H "Authorization: Bearer \${{ secrets.GITLAUNCH_API_KEY }}" \\
      -H "Content-Type: application/json" \\
      -d "$(jq -nc --arg buildId "\${{ github.sha }}" --arg message "$GITLAUNCH_COMMIT_MESSAGE" --arg commitAt "$COMMIT_AT" '{buildId:$buildId,message:$message,commitAt:$commitAt}')"`;
}

function jenkinsBuildReport(apiUrl: string, serviceId: string): string {
  return `stage('Report build to GitLaunch') {
  steps {
    withCredentials([string(credentialsId: 'gitlaunch-api-key', variable: 'GITLAUNCH_API_KEY')]) {
      sh '''
        COMMIT_AT="$(git show -s --format=%cI $GIT_COMMIT)"
        curl --fail-with-body -sS -X POST \\
          "${apiUrl}${buildsPath(serviceId)}" \\
          -H "Authorization: Bearer $GITLAUNCH_API_KEY" \\
          -H "Content-Type: application/json" \\
          -d "{\\"buildId\\":\\"$GIT_COMMIT\\",\\"commitAt\\":\\"$COMMIT_AT\\"}"
      '''
    }
  }
}`;
}

function rawBuildReport(apiUrl: string, serviceId: string): string {
  // COMMIT_AT is what turns lead time into commit-to-live. Any ISO-8601
  // timestamp will do if the build runs somewhere without the git checkout.
  return `COMMIT_AT="$(git show -s --format=%cI $COMMIT_SHA)"
curl --fail-with-body -sS -X POST \\
  "${apiUrl}${buildsPath(serviceId)}" \\
  -H "Authorization: Bearer $GITLAUNCH_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d "{\\"buildId\\":\\"$COMMIT_SHA\\",\\"commitAt\\":\\"$COMMIT_AT\\"}"`;
}

function githubDeployWorkflow(apiUrl: string, environments: string[]): string {
  const options = environments.map((name) => `          - ${name}`).join("\n");

  // Every curl below is --fail-with-body: a status report that silently fails
  // would strand the build as "deploying" in the dashboard forever.
  const report = (status: string) =>
    `curl --fail-with-body -sS -X PATCH "$DEPLOY_URL" \\
            -H "Authorization: Bearer \${{ secrets.GITLAUNCH_API_KEY }}" \\
            -H "Content-Type: application/json" \\
            -d '{"status":"${status}"}'`;

  return `name: Deploy

on:
  workflow_dispatch:
    inputs:
      environment:
        description: "Environment to deploy to"
        required: true
        type: choice
        options:
${options}
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
    env:
      ENVIRONMENT: "\${{ inputs.environment }}"
      BUILD_ID: "\${{ inputs.buildId || github.sha }}"
      DEPLOY_URL: "${apiUrl}/api/v1/services/\${{ vars.GITLAUNCH_SERVICE_ID }}/builds/\${{ inputs.buildId || github.sha }}/deploy/\${{ inputs.environment }}"
    steps:
      # Deploy the commit that was built, not whatever main points at now.
      - uses: actions/checkout@v4
        with:
          ref: "\${{ env.BUILD_ID }}"

      - name: Report deploying
        run: |
          ${report("deploying")}

      # ---------------------------------------------------------------
      # Replace this with your real deploy. Everything above and below
      # is GitLaunch reporting and should be left in place.
      # ---------------------------------------------------------------
      - name: Deploy
        run: echo "Deploying $BUILD_ID to $ENVIRONMENT"

      - name: Report deployed
        if: success()
        run: |
          ${report("deployed")}

      - name: Report failed
        if: failure()
        run: |
          ${report("error")}

      - name: Report cancelled
        if: cancelled()
        run: |
          ${report("cancelled")}`;
}

export function buildSetupSnippets(input: SetupSnippetsInput): SetupSnippets {
  const { apiUrl, serviceId } = input;
  const environments = input.environments.length
    ? input.environments
    : DEFAULT_ENVIRONMENT_NAMES;
  const defaultBranch = input.defaultBranch || FALLBACK_DEFAULT_BRANCH;

  return {
    secrets: {
      secretName: "GITLAUNCH_API_KEY",
      variableName: "GITLAUNCH_SERVICE_ID",
      serviceId,
    },
    buildReport: {
      github: githubBuildReport(apiUrl, defaultBranch),
      jenkins: jenkinsBuildReport(apiUrl, serviceId),
      raw: rawBuildReport(apiUrl, serviceId),
    },
    deploy: {
      github: githubDeployWorkflow(apiUrl, environments),
      githubPath: ".github/workflows/deploy.yml",
    },
  };
}
