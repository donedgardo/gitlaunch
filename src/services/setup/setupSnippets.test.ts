import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { buildSetupSnippets } from "./setupSnippets";
// The in-src vendored copy, not the submodule's: the Docker build only copies
// src/, and reporterContract.test.ts already pins the two byte-identical.
import goldenContract from "../dispatch/contract/reporter-contract.golden.json";

const input = {
  apiUrl: "https://gitlaunch.dev",
  serviceId: "6f2a1b3c4d5e6f7a8b9c0d1e",
  environments: ["staging", "prod"],
  defaultBranch: "main",
};

describe("buildSetupSnippets", () => {
  describe("the deploy workflow", () => {
    it("should declare exactly the inputs GitLaunch dispatches", () => {
      // Given the snippets for a service
      const snippets = buildSetupSnippets(input);

      // When the generated deploy workflow is parsed
      const workflow = parse(snippets.deploy.github);

      // Then workflow_dispatch declares environment and buildId and nothing
      // else — GitHub 422s the whole dispatch on an undeclared input.
      expect(Object.keys(workflow.on.workflow_dispatch.inputs).sort()).toEqual([
        "buildId",
        "environment",
      ]);
    });

    it("should offer the service's own environments as deploy choices", () => {
      // Given a service with custom environments
      const snippets = buildSetupSnippets({
        ...input,
        environments: ["qa", "canary", "production"],
      });

      // When the generated deploy workflow is parsed
      const workflow = parse(snippets.deploy.github);

      // Then the environment input offers exactly those
      expect(workflow.on.workflow_dispatch.inputs.environment.options).toEqual([
        "qa",
        "canary",
        "production",
      ]);
    });

    it("should be callable by another workflow so CI can auto-deploy", () => {
      // Given the snippets for a service
      const snippets = buildSetupSnippets(input);

      // When the generated deploy workflow is parsed
      const workflow = parse(snippets.deploy.github);

      // Then it also accepts workflow_call with the same inputs
      expect(Object.keys(workflow.on.workflow_call.inputs).sort()).toEqual([
        "buildId",
        "environment",
      ]);
    });

    it("should check out the build being deployed rather than the branch tip", () => {
      // Given the snippets for a service
      const snippets = buildSetupSnippets(input);

      // When the generated deploy workflow is parsed
      const workflow = parse(snippets.deploy.github);
      const checkout = workflow.jobs.deploy.steps.find((step: any) =>
        step.uses?.startsWith("actions/checkout"),
      );

      // Then checkout pins to the build id, so redeploying an older build
      // deploys that code and not whatever main happens to be
      expect(checkout.with.ref).toBe("${{ env.BUILD_ID }}");
    });

    it("should only report statuses the reporter contract allows", () => {
      // Given the snippets for a service
      const snippets = buildSetupSnippets(input);

      // When the statuses it PATCHes are collected
      const reported = [
        ...snippets.deploy.github.matchAll(/"status"\s*:\s*"(\w+)"/g),
      ].map((match) => match[1]);

      // Then every one is in the golden reporter vocabulary
      expect(reported.length).toBeGreaterThan(0);
      for (const status of reported) {
        expect(goldenContract.reporterStatuses).toContain(status);
      }
    });

    it("should report a terminal status for every job outcome", () => {
      // Given the snippets for a service
      const snippets = buildSetupSnippets(input);

      // Then success, failure and cancellation each map to their contract
      // status, so a build never sticks on "deploying"
      for (const [outcome, status] of Object.entries(
        goldenContract.outcomeToStatus,
      )) {
        expect(snippets.deploy.github).toContain(`if: ${outcome}()`);
        expect(snippets.deploy.github).toContain(`"status":"${status}"`);
      }
    });
  });

  describe("the build report snippet", () => {
    it("should POST where the contract says builds go", () => {
      // Given the snippets for a service
      const snippets = buildSetupSnippets(input);

      // Then the GitHub snippet targets the contract's build path, resolving
      // the service from the repo variable so the workflow stays portable
      const expectedPath = goldenContract.endpoints.reportBuild.path.replace(
        "{serviceId}",
        "${{ vars.GITLAUNCH_SERVICE_ID }}",
      );
      expect(snippets.buildReport.github).toContain(
        `${input.apiUrl}${expectedPath}`,
      );

      // And the snippets for tools without repo variables carry the id
      const literalPath = goldenContract.endpoints.reportBuild.path.replace(
        "{serviceId}",
        input.serviceId,
      );
      expect(snippets.buildReport.jenkins).toContain(
        `${input.apiUrl}${literalPath}`,
      );
      expect(snippets.buildReport.raw).toContain(
        `${input.apiUrl}${literalPath}`,
      );
    });

    it("should read credentials from the documented secret and variable", () => {
      // Given the snippets for a service
      const snippets = buildSetupSnippets(input);

      // Then it reads the key from a secret and the service id from a
      // variable — the key must never be committed as a plain variable
      expect(snippets.buildReport.github).toContain(
        "secrets.GITLAUNCH_API_KEY",
      );
      expect(snippets.buildReport.github).toContain(
        "vars.GITLAUNCH_SERVICE_ID",
      );
      expect(snippets.secrets.secretName).toBe("GITLAUNCH_API_KEY");
      expect(snippets.secrets.variableName).toBe("GITLAUNCH_SERVICE_ID");
    });

    it("should fail the CI step when GitLaunch rejects the report", () => {
      // Given the snippets for a service
      const snippets = buildSetupSnippets(input);

      // Then curl surfaces the error instead of silently passing
      expect(snippets.buildReport.github).toContain("--fail-with-body");
    });

    it("should report when the commit was authored so lead time is commit-to-live", () => {
      // Given the snippets for a service
      const snippets = buildSetupSnippets(input);

      // Then every variant sends a commit time. Without it GitLaunch can only
      // measure from when it first heard about the build, which silently drops
      // however long the change sat waiting for CI.
      expect(snippets.buildReport.github).toContain("commitAt");
      expect(snippets.buildReport.github).toContain(
        "github.event.head_commit.timestamp",
      );

      // Jenkins and plain shells have no such variable, so they ask git
      expect(snippets.buildReport.jenkins).toContain("commitAt");
      expect(snippets.buildReport.jenkins).toContain("git show");
      expect(snippets.buildReport.raw).toContain("commitAt");
      expect(snippets.buildReport.raw).toContain("git show");
    });

    it("should stay valid YAML once the commit time is threaded through", () => {
      // Given the GitHub build-report snippet, which is pasted into a job's
      // steps: — an unquoted commit message or timestamp would break the file
      const snippets = buildSetupSnippets(input);

      // When it is parsed as the step list it is meant to be
      const steps = parse(snippets.buildReport.github);

      // Then it is one well-formed step
      expect(Array.isArray(steps)).toBe(true);
      expect(steps).toHaveLength(1);
      expect(steps[0].name).toBeTruthy();
    });

    it("should gate the report on the repo's own default branch", () => {
      // Given a repo whose default branch is not main
      const snippets = buildSetupSnippets({
        ...input,
        defaultBranch: "master",
      });

      // Then the guard names that branch. A guard naming a branch the repo
      // does not have never fires: no error, no failed run, just a dashboard
      // that stays empty forever.
      expect(snippets.buildReport.github).toContain(
        "github.ref == 'refs/heads/master'",
      );
      expect(snippets.buildReport.github).not.toContain("refs/heads/main");
    });

    it("should gate on main when the default branch is not known", () => {
      // Given a service with no repository bound yet, so nobody can say what
      // its default branch is
      const snippets = buildSetupSnippets({ ...input, defaultBranch: "" });

      // Then the guard falls back to GitHub's own default for new repos
      expect(snippets.buildReport.github).toContain(
        "github.ref == 'refs/heads/main'",
      );
    });

    it("should provide non-GitHub variants for Jenkins and plain shells", () => {
      // Given the snippets for a service
      const snippets = buildSetupSnippets(input);

      // Then every provider gets a snippet pointing at this service
      expect(snippets.buildReport.jenkins).toContain(input.serviceId);
      expect(snippets.buildReport.raw).toContain(input.serviceId);
    });
  });

  it("should report with plain curl rather than the deprecated build-reporter action", () => {
    // Given the snippets for a service
    const snippets = buildSetupSnippets(input);

    // Then every one of them calls the API directly. The GitLaunch Build
    // Reporter action still works for anyone already on it, but it only ever
    // covered GitHub — curl is the one path that serves every provider, and
    // handing out two answers is what made "how do I report a build?"
    // ambiguous in the first place.
    for (const snippet of [
      snippets.buildReport.github,
      snippets.buildReport.jenkins,
      snippets.buildReport.raw,
      snippets.deploy.github,
    ]) {
      expect(snippet).toContain("curl");
      expect(snippet).not.toContain("build-reporter");
    }
  });

  it("should point every snippet at the configured host", () => {
    // Given a self-hosted GitLaunch
    const snippets = buildSetupSnippets({
      ...input,
      apiUrl: "https://gitlaunch.internal.acme.com",
    });

    // Then no snippet hardcodes the public host
    const all = [
      snippets.buildReport.github,
      snippets.buildReport.jenkins,
      snippets.buildReport.raw,
      snippets.deploy.github,
    ].join("\n");
    expect(all).toContain("https://gitlaunch.internal.acme.com");
    expect(all).not.toContain("https://gitlaunch.dev");
  });
});
