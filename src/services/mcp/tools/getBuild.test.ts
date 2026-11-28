import { describe, it, expect } from "vitest";
import { getBuildTool } from "./getBuild";
import { ToolRefused } from "../tool";
import {
  FakeWorkspace,
  aBuild,
  aCaller,
  aService,
  ciKey,
  maria,
} from "../fakes";
import { DeploymentStatus } from "../../service/deploymentStatus";

const at = (iso: string) => new Date(iso);
const caller = aCaller(["builds:read"]);

describe("get_build", () => {
  it("should need only permission to read builds", () => {
    const tool = getBuildTool(new FakeWorkspace(), new FakeWorkspace());

    expect(tool.name).toBe("get_build");
    expect(tool.requiredScope).toBe("builds:read");
    expect(tool.changes).toBe(false);
  });

  it("should return a build with its full deployment history: who, how, why", async () => {
    const service = aService();
    const workspace = new FakeWorkspace(
      [service],
      [
        aBuild(service, "v1", {
          message: "Add invite links",
          createdAt: at("2026-11-01T10:00:00Z"),
          logs: [
            {
              environment: "prod",
              status: DeploymentStatus.DISPATCHING,
              at: at("2026-11-02T09:00:00Z"),
              actor: maria,
              intent: "rollback",
              reason: "checkout errors after v2",
            },
            {
              environment: "prod",
              status: DeploymentStatus.DEPLOYED,
              at: at("2026-11-02T09:03:00Z"),
              actor: ciKey,
              intent: "rollback",
            },
          ],
        }),
      ],
    );

    const result = await getBuildTool(workspace, workspace).run(caller, {
      serviceId: service._id.toString(),
      buildId: "v1",
    });

    expect(result).toEqual({
      buildId: "v1",
      message: "Add invite links",
      reportedAt: at("2026-11-01T10:00:00Z"),
      deployments: { staging: "none", prod: "deployed" },
      history: [
        {
          at: at("2026-11-02T09:00:00Z"),
          environment: "prod",
          status: "dispatching",
          intent: "rollback",
          by: "Maria",
          via: "dashboard",
          reason: "checkout errors after v2",
        },
        {
          at: at("2026-11-02T09:03:00Z"),
          environment: "prod",
          status: "deployed",
          intent: "rollback",
          by: "ci-pipeline (API key)",
          via: "api",
        },
      ],
    });
  });

  it("should leave out who for history written before attribution existed", async () => {
    const service = aService();
    const workspace = new FakeWorkspace(
      [service],
      [
        aBuild(service, "v1", {
          logs: [
            {
              environment: "prod",
              status: DeploymentStatus.DEPLOYED,
              at: at("2026-01-01T00:00:00Z"),
            },
          ],
        }),
      ],
    );

    const result = (await getBuildTool(workspace, workspace).run(caller, {
      serviceId: service._id.toString(),
      buildId: "v1",
    })) as { history: Record<string, unknown>[] };

    expect(result.history[0]).not.toHaveProperty("by");
    expect(result.history[0]).not.toHaveProperty("via");
  });

  it("should refuse a build id the service does not have", async () => {
    const service = aService();
    const workspace = new FakeWorkspace([service], []);

    const attempt = getBuildTool(workspace, workspace).run(caller, {
      serviceId: service._id.toString(),
      buildId: "nope",
    });

    await expect(attempt).rejects.toThrow(ToolRefused);
    await expect(attempt).rejects.toThrow(/Build not found: nope/);
  });
});
