import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parse } from "yaml";
import { buildSetupSnippets } from "./setupSnippets";
import goldenContract from "../dispatch/contract/reporter-contract.golden.json";

/**
 * GitLaunch reports its own builds to GitLaunch, with a copy of the snippet we
 * hand customers. Nothing linked the two, so when the guidance gained a field
 * our own pipeline kept sending the old payload — and our own delivery metrics
 * were the ones measured wrong. This is the link.
 */
const OWN_CI = resolve(__dirname, "../../../.github/workflows/ci.yml");

/** The keys of the JSON object a `jq -nc ... '{a:$a,b:$b}'` call builds. */
const reportedFields = (snippet: string): string[] => {
  const jqObject = snippet.match(/jq -nc[^']*'\{([^}]*)\}'/);
  if (!jqObject) {
    throw new Error(`no jq payload found in snippet:\n${snippet}`);
  }
  return jqObject[1]
    .split(",")
    .map((pair) => pair.split(":")[0].trim())
    .sort();
};

describe("GitLaunch's own build reporting", () => {
  const workflow = parse(readFileSync(OWN_CI, "utf8"));
  const reportStep = workflow.jobs["report-build"].steps.find(
    (step: { run?: string }) =>
      step.run?.includes(
        goldenContract.endpoints.reportBuild.path.replace(
          "{serviceId}",
          "${{ vars.GITLAUNCH_SERVICE_ID }}",
        ),
      ),
  );

  it("should report a build the way our own guidance says to", () => {
    // Given: the snippet the dashboard and the setup API hand customers
    const canonical = buildSetupSnippets({
      apiUrl: "https://gitlaunch.dev",
      serviceId: "6f2a1b3c4d5e6f7a8b9c0d1e",
      environments: ["staging", "prod"],
      defaultBranch: "main",
    }).buildReport.github;

    // Then: our own pipeline sends exactly the same fields. Advice we don't
    // follow is advice we stop noticing is broken.
    expect(reportStep).toBeDefined();
    expect(reportedFields(reportStep.run)).toEqual(reportedFields(canonical));
  });

  it("should report when the commit was authored so our own lead time is commit-to-live", () => {
    // Then: the commit timestamp reaches GitLaunch. Our metrics page is the
    // first place a regression here would show up, so it has to be real.
    expect(reportedFields(reportStep.run)).toContain("commitAt");
    expect(reportStep.env.GITLAUNCH_COMMIT_AT).toBe(
      "${{ github.event.head_commit.timestamp }}",
    );
  });

  it("should only report on the pushes that populate a commit timestamp", () => {
    // Given: `head_commit` is populated for push events and null otherwise, and
    // this job has no checkout to fall back to `git show`
    // Then: the job is gated to pushes, so the timestamp is never empty
    const condition = workflow.jobs["report-build"].if;
    expect(condition).toContain("github.event_name == 'push'");
  });
});
