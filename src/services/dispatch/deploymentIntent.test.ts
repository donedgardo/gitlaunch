import { describe, it, expect } from "vitest";
import { deriveIntent } from "./deploymentIntent";

const build = (buildId: string, createdAt: string) => ({
  buildId,
  createdAt: new Date(createdAt),
});

describe("deploymentIntent", () => {
  describe("deriveIntent", () => {
    it("should be a promote when the environment is empty", () => {
      // Given nothing has ever been deployed to the environment
      // When we send a build there
      const intent = deriveIntent({
        target: build("abc", "2026-08-01T10:00:00Z"),
        current: null,
      });

      // Then there is nothing to go back from — it is a promote
      expect(intent).toBe("promote");
    });

    it("should be a promote when the build is newer than what is live", () => {
      // Given an older build is live
      // When we send a newer one
      const intent = deriveIntent({
        target: build("new", "2026-08-02T10:00:00Z"),
        current: build("old", "2026-08-01T10:00:00Z"),
      });

      // Then we are moving forward
      expect(intent).toBe("promote");
    });

    it("should be a rollback when the build is older than what is live", () => {
      // Given a newer build is live
      // When we send an older one back to the environment
      const intent = deriveIntent({
        target: build("old", "2026-08-01T10:00:00Z"),
        current: build("new", "2026-08-02T10:00:00Z"),
      });

      // Then the team is undoing a deploy
      expect(intent).toBe("rollback");
    });

    it("should be a promote when redeploying the build already live", () => {
      // Given a build is live
      // When the same build is deployed again
      const intent = deriveIntent({
        target: build("same", "2026-08-01T10:00:00Z"),
        current: build("same", "2026-08-01T10:00:00Z"),
      });

      // Then a redeploy is not an undo
      expect(intent).toBe("promote");
    });

    it("should be a promote when two different builds share a timestamp", () => {
      // Given we cannot tell which of two builds came first
      // When one replaces the other
      const intent = deriveIntent({
        target: build("a", "2026-08-01T10:00:00Z"),
        current: build("b", "2026-08-01T10:00:00Z"),
      });

      // Then we do not claim it was a rollback — change failure rate should
      // never be inflated by a guess
      expect(intent).toBe("promote");
    });
  });
});
