import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  Actor,
  apiKeyActor,
  cleanReason,
  describeActor,
  shippedBy,
} from "./actor";
import { DeploymentStatus } from "./deploymentStatus";

const maria: Actor = {
  kind: "user",
  userId: new ObjectId(),
  name: "Maria",
  via: "dashboard",
};
const ciKey: Actor = {
  kind: "apiKey",
  apiKeyId: new ObjectId(),
  name: "ci-pipeline",
  via: "api",
};

describe("actor", () => {
  describe("describeActor", () => {
    it("should name a person by their name alone", () => {
      expect(describeActor(maria)).toBe("Maria");
    });

    it("should mark an API key as one, so it never reads as a person", () => {
      expect(describeActor(ciKey)).toBe("ci-pipeline (API key)");
    });

    it("should say when a key acted through the MCP server", () => {
      expect(
        describeActor({ ...ciKey, name: "staging-agent", via: "mcp" }),
      ).toBe("staging-agent (MCP)");
    });

    it("should include the client an MCP key reported, as a label", () => {
      expect(
        describeActor({
          ...ciKey,
          name: "staging-agent",
          via: "mcp",
          client: "claude-code",
        }),
      ).toBe("staging-agent (MCP, claude-code)");
    });
  });

  describe("apiKeyActor", () => {
    it("should carry the key, its name and the person who created it", () => {
      const apiKeyId = new ObjectId();
      const createdByUserId = new ObjectId();

      const actor = apiKeyActor(
        { apiKeyId, name: "staging-agent", createdByUserId },
        "api",
      );

      expect(actor).toEqual({
        kind: "apiKey",
        apiKeyId,
        name: "staging-agent",
        via: "api",
        onBehalfOfUserId: createdByUserId,
      });
    });

    it("should still identify a key whose name is not known", () => {
      const actor = apiKeyActor({ apiKeyId: new ObjectId() }, "api");

      expect(actor.name).toBe("API key");
      expect(actor).not.toHaveProperty("onBehalfOfUserId");
    });
  });

  describe("shippedBy", () => {
    const entry = (
      environment: string,
      status: DeploymentStatus,
      actor?: Actor,
    ) => ({ environment, status, at: new Date(), ...(actor ? { actor } : {}) });

    it("should credit whoever dispatched the deploy, not the pipeline that reported it done", () => {
      const logs = [
        entry("prod", DeploymentStatus.DISPATCHING, maria),
        entry("prod", DeploymentStatus.DEPLOYING, ciKey),
        entry("prod", DeploymentStatus.DEPLOYED, ciKey),
      ];

      expect(shippedBy(logs, "prod")).toEqual(maria);
    });

    it("should credit the reporter when nobody dispatched the deploy here", () => {
      const logs = [entry("prod", DeploymentStatus.DEPLOYED, ciKey)];

      expect(shippedBy(logs, "prod")).toEqual(ciKey);
    });

    it("should look only at the environment asked about", () => {
      const logs = [
        entry("staging", DeploymentStatus.DISPATCHING, maria),
        entry("prod", DeploymentStatus.DEPLOYED, ciKey),
      ];

      expect(shippedBy(logs, "prod")).toEqual(ciKey);
    });

    it("should credit the most recent dispatch when a build went out more than once", () => {
      const logs = [
        entry("prod", DeploymentStatus.DISPATCHING, ciKey),
        entry("prod", DeploymentStatus.DEPLOYED, ciKey),
        entry("prod", DeploymentStatus.DISPATCHING, maria),
        entry("prod", DeploymentStatus.DEPLOYED, ciKey),
      ];

      expect(shippedBy(logs, "prod")).toEqual(maria);
    });

    it("should be unknown for a dispatch recorded before attribution existed, rather than crediting the pipeline", () => {
      const logs = [
        entry("prod", DeploymentStatus.DISPATCHING),
        entry("prod", DeploymentStatus.DEPLOYED, ciKey),
      ];

      expect(shippedBy(logs, "prod")).toBeUndefined();
    });

    it("should be unknown for a build with no history at all", () => {
      expect(shippedBy(undefined, "prod")).toBeUndefined();
      expect(shippedBy([], "prod")).toBeUndefined();
    });
  });

  describe("cleanReason", () => {
    it("should keep a stated reason, trimmed", () => {
      expect(cleanReason("  smoke test failed on /checkout ")).toBe(
        "smoke test failed on /checkout",
      );
    });

    it("should be absent when nothing usable was given", () => {
      expect(cleanReason(undefined)).toBeUndefined();
      expect(cleanReason("   ")).toBeUndefined();
      expect(cleanReason(42)).toBeUndefined();
    });

    it("should cap a reason so a log entry cannot be made arbitrarily large", () => {
      expect(cleanReason("x".repeat(1000))!.length).toBe(280);
    });
  });
});
