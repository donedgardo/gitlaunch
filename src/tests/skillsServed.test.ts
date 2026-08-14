import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import path from "path";

/**
 * The onboarding handoff prompt points a coding agent at
 * <host>/skills/gitlaunch-onboarding/SKILL.md. If that path stops resolving,
 * the AI onboarding path silently breaks for every new customer, so the files
 * and the way they ship are pinned here.
 */
describe("Agent Skills delivery", () => {
  const repoRoot = path.join(__dirname, "../..");
  const skillDir = path.join(repoRoot, "skills/gitlaunch-onboarding");

  it("should ship the skill and every reference it names", () => {
    // Given the onboarding skill
    const skillPath = path.join(skillDir, "SKILL.md");
    expect(existsSync(skillPath)).toBe(true);
    const skill = readFileSync(skillPath, "utf8");

    // When the reference files it points at are resolved
    const referenced = [...skill.matchAll(/`references\/([\w.-]+\.md)`/g)].map(
      (match) => match[1],
    );

    // Then each one exists — a dangling pointer strands the agent
    expect(referenced.length).toBeGreaterThan(0);
    for (const file of new Set(referenced)) {
      expect(
        existsSync(path.join(skillDir, "references", file)),
        `referenced but missing: references/${file}`,
      ).toBe(true);
    }
  });

  it("should declare the frontmatter that makes the skill discoverable", () => {
    // Given the skill file
    const skill = readFileSync(path.join(skillDir, "SKILL.md"), "utf8");

    // Then it opens with a name and description agents match against
    expect(skill.startsWith("---\n")).toBe(true);
    const frontmatter = skill.slice(4, skill.indexOf("\n---", 4));
    expect(frontmatter).toContain("name: gitlaunch-onboarding");
    expect(frontmatter).toMatch(/description: .+/);
  });

  it("should not contain a real API key", () => {
    // Given every file in the skill
    const files = [
      "SKILL.md",
      "references/detection.md",
      "references/github-actions.md",
      "references/other-ci.md",
      "references/troubleshooting.md",
    ].map((file) => readFileSync(path.join(skillDir, file), "utf8"));

    // Then none of them carries something shaped like a live credential
    for (const contents of files) {
      expect(contents).not.toMatch(/\b[sp]k_[a-z0-9-]+_[A-Za-z0-9_-]{20,}/);
    }
  });

  it("should be copied into the production image", () => {
    // Given the Dockerfile
    const dockerfile = readFileSync(path.join(repoRoot, "Dockerfile"), "utf8");

    // Then the skills directory ships — it is not part of the compiled dist
    expect(dockerfile).toMatch(/^COPY skills \.\/skills$/m);
  });
});
