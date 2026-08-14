// GitLaunch Enterprise Feature — licensed under LICENSE-enterprise.md, not the FSL.

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// The open-core boundary is a licensing claim, and a licensing claim that
// quietly stops matching the code is worse than none at all: it is what someone
// points at in a dispute. So the manifest is checked against the tree rather
// than trusted.

// Vitest runs with the working directory at the project root. Deriving the root
// from this file instead would need `import.meta`, which the CommonJS build
// rejects — and this file is compiled by `yarn build` like any other.
const REPO_ROOT = process.cwd();

const MANIFEST = "ENTERPRISE-PATHS.md";

const HEADER_MARKER = "LICENSE-enterprise.md";

// Only files we can carry a comment in are checked for the header. Everything
// else in a covered path is still covered — the manifest is what grants
// coverage, the header is only there so a reader of a single file knows.
const ANNOTATABLE = [".ts", ".hbs"];

const IGNORED_DIRS = new Set(["node_modules", "dist", ".git"]);

type Manifest = {
  covered: string[];
  reserved: string[];
};

// Entries are either an exact file path or a directory followed by `/**`. Those
// two forms are all the manifest is allowed to use, so that what is covered can
// be read off the document without running anything.
function readManifest(): Manifest {
  const source = readFileSync(join(REPO_ROOT, MANIFEST), "utf8");
  return {
    covered: fencedListUnder(source, "## Covered paths"),
    reserved: fencedListUnder(source, "## Reserved paths"),
  };
}

function fencedListUnder(source: string, heading: string): string[] {
  const afterHeading = source.split(heading)[1];
  if (afterHeading === undefined) {
    throw new Error(`${MANIFEST} is missing the "${heading}" section`);
  }
  const fence = afterHeading.split("```");
  if (fence.length < 3) {
    throw new Error(`${MANIFEST} has no fenced list under "${heading}"`);
  }
  return fence[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function filesUnder(entry: string): string[] {
  if (!entry.endsWith("/**")) return [entry];
  const dir = join(REPO_ROOT, entry.slice(0, -3));
  const found: string[] = [];
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      if (IGNORED_DIRS.has(name)) continue;
      const full = join(at, name);
      if (statSync(full).isDirectory()) walk(full);
      else found.push(relative(REPO_ROOT, full));
    }
  };
  walk(dir);
  return found;
}

describe("open-core license boundary", () => {
  it("should publish both license documents alongside the manifest", () => {
    for (const doc of ["LICENSE.md", "LICENSE-enterprise.md", MANIFEST]) {
      expect(existsSync(join(REPO_ROOT, doc)), `${doc} is missing`).toBe(true);
    }
  });

  it("should only claim coverage over paths that exist", () => {
    const missing = readManifest()
      .covered.map((entry) =>
        entry.endsWith("/**") ? entry.slice(0, -3) : entry,
      )
      .filter((path) => !existsSync(join(REPO_ROOT, path)));

    expect(
      missing,
      "these paths are named in the manifest but not in the tree — move them to Reserved paths or fix the entry",
    ).toEqual([]);
  });

  it("should mark every covered source file as enterprise-licensed", () => {
    const unmarked = readManifest()
      .covered.flatMap(filesUnder)
      .filter((file) => ANNOTATABLE.some((ext) => file.endsWith(ext)))
      .filter(
        (file) =>
          !readFileSync(join(REPO_ROOT, file), "utf8").includes(HEADER_MARKER),
      );

    expect(
      unmarked,
      `these files sit under an enterprise path but carry no ${HEADER_MARKER} header`,
    ).toEqual([]);
  });

  it("should not reserve a path that already exists", () => {
    // A reserved path is a promise about code not written yet. Once it exists
    // it has to move up to Covered, or nothing is checking its headers.
    const landed = readManifest()
      .reserved.map((entry) =>
        entry.endsWith("/**") ? entry.slice(0, -3) : entry,
      )
      .filter((path) => existsSync(join(REPO_ROOT, path)));

    expect(
      landed,
      "these reserved paths now exist — promote them to Covered paths",
    ).toEqual([]);
  });
});
