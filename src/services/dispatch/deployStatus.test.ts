import { describe, it, expect } from "vitest";
import { DeploymentStatus } from "../service/deploymentStatus";
import { outcomeToStatus, isLegalTransition } from "./deployStatus";
import type { CIOutcome, TransitionResult } from "./deployStatus";

describe("deployStatus", () => {
  describe("outcomeToStatus", () => {
    it("should return DEPLOYED when outcome is success", () => {
      expect(outcomeToStatus("success")).toBe(DeploymentStatus.DEPLOYED);
    });

    it("should return CANCELLED when outcome is cancelled", () => {
      expect(outcomeToStatus("cancelled")).toBe(DeploymentStatus.CANCELLED);
    });

    it("should return ERROR when outcome is failure", () => {
      expect(outcomeToStatus("failure")).toBe(DeploymentStatus.ERROR);
    });
  });

  describe("isLegalTransition", () => {
    it("should return ok: true for NONE -> DISPATCHING", () => {
      const result = isLegalTransition(
        DeploymentStatus.NONE,
        DeploymentStatus.DISPATCHING,
      );
      expect(result).toEqual({ ok: true });
    });

    it("should return ok: true for DISPATCHING -> DEPLOYING", () => {
      const result = isLegalTransition(
        DeploymentStatus.DISPATCHING,
        DeploymentStatus.DEPLOYING,
      );
      expect(result).toEqual({ ok: true });
    });

    it("should return ok: true for DISPATCHING -> CANCELLED", () => {
      const result = isLegalTransition(
        DeploymentStatus.DISPATCHING,
        DeploymentStatus.CANCELLED,
      );
      expect(result).toEqual({ ok: true });
    });

    it("should return ok: true for DISPATCHING -> ERROR", () => {
      const result = isLegalTransition(
        DeploymentStatus.DISPATCHING,
        DeploymentStatus.ERROR,
      );
      expect(result).toEqual({ ok: true });
    });

    it("should return ok: true for DEPLOYING -> DEPLOYED", () => {
      const result = isLegalTransition(
        DeploymentStatus.DEPLOYING,
        DeploymentStatus.DEPLOYED,
      );
      expect(result).toEqual({ ok: true });
    });

    it("should return ok: true for DEPLOYING -> CANCELLED", () => {
      const result = isLegalTransition(
        DeploymentStatus.DEPLOYING,
        DeploymentStatus.CANCELLED,
      );
      expect(result).toEqual({ ok: true });
    });

    it("should return ok: true for DEPLOYING -> ERROR", () => {
      const result = isLegalTransition(
        DeploymentStatus.DEPLOYING,
        DeploymentStatus.ERROR,
      );
      expect(result).toEqual({ ok: true });
    });

    it("should return ok: true for DEPLOYED -> DISPATCHING (re-deploy)", () => {
      const result = isLegalTransition(
        DeploymentStatus.DEPLOYED,
        DeploymentStatus.DISPATCHING,
      );
      expect(result).toEqual({ ok: true });
    });

    it("should return ok: true for ERROR -> DISPATCHING (re-deploy)", () => {
      const result = isLegalTransition(
        DeploymentStatus.ERROR,
        DeploymentStatus.DISPATCHING,
      );
      expect(result).toEqual({ ok: true });
    });

    it("should return ok: true for CANCELLED -> DISPATCHING (re-deploy)", () => {
      const result = isLegalTransition(
        DeploymentStatus.CANCELLED,
        DeploymentStatus.DISPATCHING,
      );
      expect(result).toEqual({ ok: true });
    });

    it("should return ok: false with reason containing Illegal transition for NONE -> DEPLOYED", () => {
      const result = isLegalTransition(
        DeploymentStatus.NONE,
        DeploymentStatus.DEPLOYED,
      );
      expect(result.ok).toBe(false);
      expect((result as { ok: false; reason: string }).reason).toContain(
        "Illegal transition",
      );
    });

    it("should return ok: false with reason containing Illegal transition for DEPLOYING -> DISPATCHING", () => {
      const result = isLegalTransition(
        DeploymentStatus.DEPLOYING,
        DeploymentStatus.DISPATCHING,
      );
      expect(result.ok).toBe(false);
      expect((result as { ok: false; reason: string }).reason).toContain(
        "Illegal transition",
      );
    });

    it("should return ok: false with reason containing Illegal transition for DEPLOYED -> DEPLOYING", () => {
      const result = isLegalTransition(
        DeploymentStatus.DEPLOYED,
        DeploymentStatus.DEPLOYING,
      );
      expect(result.ok).toBe(false);
      expect((result as { ok: false; reason: string }).reason).toContain(
        "Illegal transition",
      );
    });
  });
});
