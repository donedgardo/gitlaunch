import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

// The manifest says which code is commercial. This says the commercial code
// could actually be *removed* — that nothing in the open core reaches into it.
//
// Without this, "enterprise" is a label on files that the free product still
// depends on, and the boundary only exists on paper. With it, the dependency
// arrow points one way: enterprise may use core, core may never use enterprise.
//
// This file must live in the open core. A portability check that ships inside
// the thing it is checking would be deleted along with it.

const REPO_ROOT = process.cwd();

const MANIFEST = "ENTERPRISE-PATHS.md";

// The composition root is allowed to know both sides — something has to choose
// which implementation gets built and which routes get registered. These are the
// only files that may, and that is the whole point: removing the enterprise code
// is an edit to the wiring, not a search through the tree.
//
// Be strict about what goes on this list. Every addition is a file that has to
// be reworked by hand when the enterprise paths move, and a place where a
// feature can quietly reach across the boundary and still pass this test.
const COMPOSITION_ROOT = ["src/index.ts", "src/server/createAppServer.ts"];

// Open-core tests that drive a commercial implementation through a core port.
// They are exceptions to the same rule, held separately because a test crossing
// the boundary costs less than a shipped file crossing it: deleting ee/ deletes
// the coverage, not the product.
//
// Both are here because an enterprise capability is still reachable from a core
// route, which is the real defect — see "Known gaps" in ENTERPRISE-PATHS.md.
// When those routes move, these entries go with them.
const ENTERPRISE_COUPLED_TESTS = [
  // Plan selection and trial start, served by src/server/routes/onboarding/.
  "src/server/routes/onboarding/index.test.ts",
  // Redeeming a pending invite at first login, via the PendingInviteRedeemer
  // port. The test supplies the commercial redeemer to check the seam holds.
  "src/server/routes/auth/github.test.ts",
];

const IGNORED_DIRS = new Set(["node_modules", "dist", ".git"]);

function coveredPaths(): string[] {
  const source = readFileSync(join(REPO_ROOT, MANIFEST), "utf8");
  return source
    .split("## Covered paths")[1]
    .split("```")[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function isEnterprise(path: string, covered: string[]): boolean {
  return covered.some((entry) =>
    entry.endsWith("/**")
      ? path.startsWith(entry.slice(0, -2))
      : entry === path || entry === `${path}.ts`,
  );
}

function sourceFiles(includeTests: boolean): string[] {
  const found: string[] = [];
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      if (IGNORED_DIRS.has(name)) continue;
      const full = join(at, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".ts")) {
        if (!includeTests && name.endsWith(".test.ts")) continue;
        found.push(relative(REPO_ROOT, full).split("\\").join("/"));
      }
    }
  };
  walk(join(REPO_ROOT, "src"));
  return found;
}

const RELATIVE_IMPORT = /from\s+["'](\.[^"']+)["']/g;

// Where a relative import lands, as a repo-relative path with no extension.
function importTargets(file: string): string[] {
  const source = readFileSync(join(REPO_ROOT, file), "utf8");
  const targets: string[] = [];
  for (const match of source.matchAll(RELATIVE_IMPORT)) {
    const resolved = resolve(dirname(join(REPO_ROOT, file)), match[1]);
    targets.push(relative(REPO_ROOT, resolved).split("\\").join("/"));
  }
  return targets;
}

function crossings(files: string[], covered: string[]): string[] {
  return files.flatMap((file) =>
    importTargets(file)
      .filter((target) => isEnterprise(target, covered))
      .map((target) => `${file} -> ${target}`),
  );
}

describe("open-core portability", () => {
  it("should keep the open core free of imports from enterprise paths", () => {
    const covered = coveredPaths();

    const violations = crossings(
      sourceFiles(false).filter((file) => !COMPOSITION_ROOT.includes(file)),
      covered,
    );

    expect(
      violations,
      "open-core files import enterprise code, so the enterprise paths could not be removed — depend on a port in the core instead",
    ).toEqual([]);
  });

  it("should keep the open-core test suite runnable without the enterprise code", () => {
    // Same rule, applied to tests. A core test that constructs a commercial
    // service is how the boundary rots unnoticed: production code stays clean
    // while the suite quietly stops standing on its own.
    const covered = coveredPaths();

    const violations = crossings(
      sourceFiles(true)
        .filter((file) => file.endsWith(".test.ts"))
        .filter((file) => !ENTERPRISE_COUPLED_TESTS.includes(file)),
      covered,
    );

    expect(
      violations,
      "open-core tests import enterprise code — use the open-core implementations in services/limits/openCorePolicy.ts, or record the test in ENTERPRISE_COUPLED_TESTS with the reason",
    ).toEqual([]);
  });

  it("should not carry an exception for a test that no longer needs one", () => {
    // An exception list nobody prunes becomes a permission slip. If a listed
    // test has been cleaned up, the entry has to go so the next one is noticed.
    const covered = coveredPaths();

    const stale = ENTERPRISE_COUPLED_TESTS.filter(
      (file) => crossings([file], covered).length === 0,
    );

    expect(
      stale,
      "these tests no longer import enterprise code — drop them from ENTERPRISE_COUPLED_TESTS",
    ).toEqual([]);
  });
});
