import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

/**
 * A self-hosted GitLaunch is not gitlaunch.dev.
 *
 * The GitHub Actions setup guides once carried their own copy of the CI/CD
 * YAML with the hosted host baked into it. On a self-hosted install that told
 * the customer to POST their builds — carrying their own API key in an
 * `Authorization: Bearer` header — to somebody else's service: the builds never
 * reached their instance, and the credential went to a third party. It was
 * silent, and it lasted as long as it did because the copy in the template had
 * drifted from `setupSnippets.ts`, which had the host right all along.
 *
 * So a template never spells an API endpoint out in full. It renders one from
 * this instance's `apiUrl`, or from a snippet this generator built for it.
 */
describe("templates and the setup snippet generator", () => {
  const templatesDir = path.join(__dirname, "../../templates");

  function templateFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) return templateFiles(full);
      return full.endsWith(".hbs") ? [full] : [];
    });
  }

  it("should never hardcode an absolute API endpoint in a template", () => {
    // Given every Handlebars template we render
    const files = templateFiles(templatesDir);
    expect(files.length).toBeGreaterThan(0);

    // When each is scanned for a fully-spelled-out API URL
    const offenders = files.flatMap((file) => {
      const matches = readFileSync(file, "utf8").match(
        /https?:\/\/[^\s"'<{]*\/api\/v1\//g,
      );
      return (matches ?? []).map(
        (match) => `${path.relative(templatesDir, file)}: ${match}`,
      );
    });

    // Then there are none — the host belongs to the instance, not the template
    expect(offenders).toEqual([]);
  });
});
