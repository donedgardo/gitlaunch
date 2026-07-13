import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// The golden vector lives in the main repo (source of truth) and is vendored
// byte-identically into the github-action submodule. ncc bundles the reporter
// standalone, so the two repos cannot share code directly — this test is what
// keeps their copies from drifting. It can read the vendored copy because the
// submodule is checked out in-tree at github-action/.
const SOURCE_OF_TRUTH = resolve(__dirname, "reporter-contract.golden.json");
const VENDORED_IN_REPORTER = resolve(
  __dirname,
  "../../../../github-action/src/contract/reporter-contract.golden.json",
);

describe("reporter contract drift", () => {
  it("should keep the vendored reporter fixture byte-identical to the source of truth", () => {
    const source = readFileSync(SOURCE_OF_TRUTH, "utf8");
    const vendored = readFileSync(VENDORED_IN_REPORTER, "utf8");
    expect(vendored).toBe(source);
  });
});
