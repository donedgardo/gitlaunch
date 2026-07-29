import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(__dirname, "add-private-key.sh");
const PEM = [
  "-----BEGIN RSA PRIVATE KEY-----",
  "MIIEexampleLineOne",
  "MIIEexampleLineTwo",
  "-----END RSA PRIVATE KEY-----",
].join("\n");

// The script writes to ./.env, so it has to be run from the directory that
// owns that .env — a throwaway one per test.
describe("add-private-key.sh", () => {
  let dir: string;

  const run = (args: string[] = ["key.pem"]) =>
    execFileSync("bash", [SCRIPT, ...args], { cwd: dir, encoding: "utf8" });

  const env = () => readFileSync(join(dir, ".env"), "utf8");

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "add-private-key-"));
    writeFileSync(join(dir, "key.pem"), PEM + "\n");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("should write the key as a single escaped line when .env has no key yet", () => {
    writeFileSync(join(dir, ".env"), "MONGODB_URI=x\nPORT=3050\n");

    run();

    expect(env()).toContain(
      'GH_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\\nMIIEexampleLineOne\\nMIIEexampleLineTwo\\n-----END RSA PRIVATE KEY-----"',
    );
  });

  it("should replace an existing key rather than adding a second one", () => {
    writeFileSync(
      join(dir, ".env"),
      'MONGODB_URI=x\nGH_APP_PRIVATE_KEY="stale-key"\nPORT=3050\n',
    );

    run();

    const contents = env();
    const occurrences = contents.match(/^GH_APP_PRIVATE_KEY=/gm) ?? [];
    expect(occurrences).toHaveLength(1);
    expect(contents).not.toContain("stale-key");
    expect(contents).toContain("MIIEexampleLineOne");
  });

  it("should leave the other variables in .env untouched", () => {
    writeFileSync(
      join(dir, ".env"),
      'MONGODB_URI=x\nGH_APP_PRIVATE_KEY="stale-key"\nPORT=3050\n',
    );

    run();

    expect(env()).toContain("MONGODB_URI=x");
    expect(env()).toContain("PORT=3050");
  });

  it("should create .env when it does not exist", () => {
    run();

    expect(env()).toContain("GH_APP_PRIVATE_KEY=");
  });

  it("should keep .env unreadable to other users", () => {
    run();

    const mode = statSync(join(dir, ".env")).mode & 0o077;
    expect(mode).toBe(0);
  });

  it("should fail when the pem file does not exist", () => {
    expect(() => run(["nope.pem"])).toThrow();
  });

  it("should fail when no argument is given", () => {
    expect(() => run([])).toThrow();
  });
});
