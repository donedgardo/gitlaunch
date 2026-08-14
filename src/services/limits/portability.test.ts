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
// which implementation gets built. Removing the enterprise code means editing
// this one file, which is the point: one edit, not a search through the tree.
const COMPOSITION_ROOT = ["src/index.ts"];

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

function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      if (IGNORED_DIRS.has(name)) continue;
      const full = join(at, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
        found.push(relative(REPO_ROOT, full));
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
    targets.push(relative(REPO_ROOT, resolved));
  }
  return targets;
}

describe("open-core portability", () => {
  it("should keep the open core free of imports from enterprise paths", () => {
    const covered = coveredPaths();

    const violations = sourceFiles()
      .filter((file) => !isEnterprise(file, covered))
      .filter((file) => !COMPOSITION_ROOT.includes(file))
      .flatMap((file) =>
        importTargets(file)
          .filter((target) => isEnterprise(target, covered))
          .map((target) => `${file} -> ${target}`),
      );

    expect(
      violations,
      "open-core files import enterprise code, so the enterprise paths could not be removed — depend on a port in the core instead",
    ).toEqual([]);
  });
});
