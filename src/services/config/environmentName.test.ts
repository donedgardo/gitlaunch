import { describe, it, expect } from "vitest";

import { resolveEnvironmentName } from "./environmentName";

describe("resolveEnvironmentName", () => {
  it("should use GITLAUNCH_ENV when set", () => {
    const name = resolveEnvironmentName({
      GITLAUNCH_ENV: "staging",
      GITLAUNCH_FLAG_ENV: "prod",
      NODE_ENV: "production",
    } as NodeJS.ProcessEnv);

    expect(name).toBe("staging");
  });

  it("should accept GITLAUNCH_FLAG_ENV as the legacy name so existing deploys keep their label", () => {
    const name = resolveEnvironmentName({
      GITLAUNCH_FLAG_ENV: "prod",
      NODE_ENV: "production",
    } as NodeJS.ProcessEnv);

    expect(name).toBe("prod");
  });

  it("should fall back to NODE_ENV when the instance is not explicitly labelled", () => {
    const name = resolveEnvironmentName({
      NODE_ENV: "production",
    } as NodeJS.ProcessEnv);

    expect(name).toBe("production");
  });

  it("should describe an unlabelled instance as development", () => {
    expect(resolveEnvironmentName({} as NodeJS.ProcessEnv)).toBe("development");
  });

  it("should use the caller's fallback when nothing in the environment names it", () => {
    // The self-flag scope has always defaulted to "prod"; resolving must not
    // silently move which flag environment it reads.
    expect(resolveEnvironmentName({} as NodeJS.ProcessEnv, "prod")).toBe(
      "prod",
    );
  });

  it("should ignore blank values rather than labelling an instance with an empty string", () => {
    const name = resolveEnvironmentName({
      GITLAUNCH_ENV: "",
      GITLAUNCH_FLAG_ENV: "  ",
      NODE_ENV: "production",
    } as NodeJS.ProcessEnv);

    expect(name).toBe("production");
  });
});
