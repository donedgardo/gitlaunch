/**
 * The canonical CI/CD snippets we hand to customers.
 *
 * This is the single source of truth. The onboarding UI, the per-service
 * settings page and the setup-snippets API all render from here, so an AI
 * agent wiring up a repo and a human copy-pasting from the dashboard cannot
 * drift apart.
 *
 * Two contracts constrain what this may emit, both covered by tests:
 *   1. The deploy workflow must declare exactly the inputs
 *      `MultiTenantGithubDispatchService` sends (`environment`, `buildId`).
 *      GitHub rejects the entire dispatch with 422 on an undeclared input.
 *   2. Reported statuses must come from the golden reporter contract shared
 *      with the github-action submodule.
 */

export type SetupSnippetsInput = {
  /** Base URL of this GitLaunch instance — self-hosts are not gitlaunch.dev. */
  apiUrl: string;
  serviceId: string;
  /** The service's own environments, in display order. */
  environments: string[];
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

const buildsPath = (serviceId: string) =>
  `/api/v1/services/${serviceId}/builds`;

function githubBuildReport(apiUrl: string): string {
  // Uses vars/secrets rather than the literal service id so the snippet keeps
  // working if the repo is pointed at a different service.
  return `- name: Report build to GitLaunch
  if: github.ref == 'refs/heads/main'
  env:
    GITLAUNCH_COMMIT_MESSAGE: \${{ github.event.head_commit.message }}
  run: |
    curl --fail-with-body -sS -X POST \\
      "${apiUrl}/api/v1/services/\${{ vars.GITLAUNCH_SERVICE_ID }}/builds" \\
      -H "Authorization: Bearer \${{ secrets.GITLAUNCH_API_KEY }}" \\
      -H "Content-Type: application/json" \\
      -d "$(jq -nc --arg buildId "\${{ github.sha }}" --arg message "$GITLAUNCH_COMMIT_MESSAGE" '{buildId:$buildId,message:$message}')"`;
}

function jenkinsBuildReport(apiUrl: string, serviceId: string): string {
  return `stage('Report build to GitLaunch') {
  steps {
    withCredentials([string(credentialsId: 'gitlaunch-api-key', variable: 'GITLAUNCH_API_KEY')]) {
      sh '''
        curl --fail-with-body -sS -X POST \\
          "${apiUrl}${buildsPath(serviceId)}" \\
          -H "Authorization: Bearer $GITLAUNCH_API_KEY" \\
          -H "Content-Type: application/json" \\
          -d "{\\"buildId\\":\\"$GIT_COMMIT\\"}"
      '''
    }
  }
}`;
}

function rawBuildReport(apiUrl: string, serviceId: string): string {
  return `curl --fail-with-body -sS -X POST \\
  "${apiUrl}${buildsPath(serviceId)}" \\
  -H "Authorization: Bearer $GITLAUNCH_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d "{\\"buildId\\":\\"$COMMIT_SHA\\"}"`;
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

  return {
    secrets: {
      secretName: "GITLAUNCH_API_KEY",
      variableName: "GITLAUNCH_SERVICE_ID",
      serviceId,
    },
    buildReport: {
      github: githubBuildReport(apiUrl),
      jenkins: jenkinsBuildReport(apiUrl, serviceId),
      raw: rawBuildReport(apiUrl, serviceId),
    },
    deploy: {
      github: githubDeployWorkflow(apiUrl, environments),
      githubPath: ".github/workflows/deploy.yml",
    },
  };
}
