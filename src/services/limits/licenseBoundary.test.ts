import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// The open-core boundary is a licensing claim, and a licensing claim that
// quietly stops matching the code is worse than none at all: it is what someone
// points at in a dispute. So the manifest is checked against the tree rather
// than trusted.
//
// This file lives in the open core, next to portability.test.ts, and not in
// ee/. A boundary check that shipped inside the thing it checks would be
// deleted along with it, and the deletion is exactly the moment the claim needs
// verifying.

// Vitest runs with the working directory at the project root. Deriving the root
// from this file instead would need `import.meta`, which the CommonJS build
// rejects — and this file is compiled by `yarn build` like any other.
const REPO_ROOT = process.cwd();

const MANIFEST = "ENTERPRISE-PATHS.md";

// The stamped header, matched as the whole sentence rather than just the file
// name: this test talks *about* the enterprise license without being under it,
// and so do a handful of open-core comments.
//
// Joined from two halves so the sentence never appears contiguously in this
// file. The stray-header check below walks the open core, and this file is part
// of it — spelling the stamp out here would make the check flag itself.
const HEADER_MARKER = [
  "GitLaunch Enterprise Feature — licensed under",
  "LICENSE-enterprise.md, not the FSL.",
].join(" ");

// Only files we can carry a comment in are checked for the header. Everything
// else in a covered path is still covered — the manifest is what grants
// coverage, the header is only there so a reader of a single file knows.
const ANNOTATABLE = [".ts", ".hbs"];

const IGNORED_DIRS = new Set(["node_modules", "dist", ".git"]);

// Where the open core lives. Walked when checking that the enterprise header
// has not escaped into files the FSL covers.
const CORE_ROOTS = ["src", "scripts"];

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

function walk(dir: string): string[] {
  const found: string[] = [];
  const visit = (at: string) => {
    for (const name of readdirSync(at)) {
      if (IGNORED_DIRS.has(name)) continue;
      const full = join(at, name);
      if (statSync(full).isDirectory()) visit(full);
      else found.push(relative(REPO_ROOT, full).split("\\").join("/"));
    }
  };
  visit(dir);
  return found;
}

function filesUnder(entry: string): string[] {
  if (!entry.endsWith("/**")) return [entry];
  return walk(join(REPO_ROOT, entry.slice(0, -3)));
}

function isCovered(file: string, covered: string[]): boolean {
  return covered.some((entry) =>
    entry.endsWith("/**")
      ? file.startsWith(entry.slice(0, -2))
      : entry === file,
  );
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
      "these files sit under an enterprise path but carry no enterprise-license header",
    ).toEqual([]);
  });

  it("should not leave the enterprise header on a file the FSL covers", () => {
    // The mirror of the check above, and the one that catches a file moved back
    // out of ee/ with its header still attached. A stray header is a file
    // claiming to be commercial while shipping under the FSL — the same
    // mismatch as an unmarked covered file, pointing the other way.
    const covered = readManifest().covered;

    const stray = CORE_ROOTS.filter((root) => existsSync(join(REPO_ROOT, root)))
      .flatMap((root) => walk(join(REPO_ROOT, root)))
      .filter((file) => ANNOTATABLE.some((ext) => file.endsWith(ext)))
      .filter((file) => !isCovered(file, covered))
      .filter((file) =>
        readFileSync(join(REPO_ROOT, file), "utf8").includes(HEADER_MARKER),
      );

    expect(
      stray,
      "these open-core files carry the enterprise-license header — move them under ee/, add them to the manifest, or drop the header",
    ).toEqual([]);
  });

  it("should keep every covered path inside ee/, bar the documented templates", () => {
    // The point of ee/ is that "what is commercial" is answerable by looking at
    // one directory. Each entry outside it is a place that stops being true, so
    // they are enumerated here rather than merely allowed: the handlebars view
    // engine takes a single template root (see ENTERPRISE-PATHS.md), so these
    // five stay under src/templates until it does not.
    const TEMPLATE_EXCEPTIONS = [
      "src/templates/invite/**",
      "src/templates/settings/team.hbs",
      "src/templates/settings/billing.hbs",
      "src/templates/onboarding/plan-selection.hbs",
    ];

    const outside = readManifest().covered.filter(
      (entry) =>
        !entry.startsWith("ee/") && !TEMPLATE_EXCEPTIONS.includes(entry),
    );

    expect(
      outside,
      "these covered paths live outside ee/ — move them in, or record the reason here and in the manifest",
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
