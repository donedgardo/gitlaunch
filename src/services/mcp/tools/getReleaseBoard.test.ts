import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { getReleaseBoardTool } from "./getReleaseBoard";
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

type Board = {
  service: { id: string; name: string };
  environments: {
    name: string;
    live: null | {
      buildId: string;
      message?: string;
      deployedAt: Date;
      deployedBy?: string;
    };
    inFlight: null | { buildId: string; status: string };
  }[];
  builds: { buildId: string; deployments: Record<string, string> }[];
  moreBuilds: boolean;
};

describe("get_release_board", () => {
  it("should need only permission to read builds", () => {
    const tool = getReleaseBoardTool(new FakeWorkspace(), new FakeWorkspace());

    expect(tool.name).toBe("get_release_board");
    expect(tool.requiredScope).toBe("builds:read");
    expect(tool.changes).toBe(false);
  });

  it("should say which build is live in each environment and who shipped it", async () => {
    const service = aService();
    const workspace = new FakeWorkspace(
      [service],
      [
        aBuild(service, "v1", {
          message: "Fix session cookie expiry",
          createdAt: at("2026-11-01T10:00:00Z"),
          logs: [
            {
              environment: "prod",
              status: DeploymentStatus.DISPATCHING,
              at: at("2026-11-02T09:00:00Z"),
              actor: maria,
            },
            {
              environment: "prod",
              status: DeploymentStatus.DEPLOYED,
              at: at("2026-11-02T09:03:00Z"),
              actor: ciKey,
            },
          ],
        }),
      ],
    );

    const board = (await getReleaseBoardTool(workspace, workspace).run(caller, {
      serviceId: service._id.toString(),
    })) as Board;

    expect(board.service).toEqual({
      id: service._id.toString(),
      name: "web-app",
    });
    expect(board.environments).toEqual([
      { name: "staging", live: null, inFlight: null },
      {
        name: "prod",
        live: {
          buildId: "v1",
          message: "Fix session cookie expiry",
          deployedAt: at("2026-11-02T09:03:00Z"),
          deployedBy: "Maria",
        },
        inFlight: null,
      },
    ]);
  });

  it("should show a deploy that is still on its way", async () => {
    const service = aService();
    const workspace = new FakeWorkspace(
      [service],
      [
        aBuild(service, "v2", {
          logs: [
            {
              environment: "staging",
              status: DeploymentStatus.DEPLOYING,
              at: at("2026-11-03T09:00:00Z"),
            },
          ],
        }),
      ],
    );

    const board = (await getReleaseBoardTool(workspace, workspace).run(caller, {
      serviceId: service._id.toString(),
    })) as Board;

    expect(board.environments[0]).toEqual({
      name: "staging",
      live: null,
      inFlight: { buildId: "v2", status: "deploying" },
    });
  });

  it("should list recent builds newest first with their status in every environment", async () => {
    const service = aService();
    const workspace = new FakeWorkspace(
      [service],
      [
        aBuild(service, "old", { createdAt: at("2026-11-01T00:00:00Z") }),
        aBuild(service, "new", {
          createdAt: at("2026-11-02T00:00:00Z"),
          logs: [
            {
              environment: "staging",
              status: DeploymentStatus.DEPLOYED,
              at: at("2026-11-02T01:00:00Z"),
            },
          ],
        }),
      ],
    );

    const board = (await getReleaseBoardTool(workspace, workspace).run(caller, {
      serviceId: service._id.toString(),
    })) as Board;

    expect(board.builds.map((b) => b.buildId)).toEqual(["new", "old"]);
    expect(board.builds[0].deployments).toEqual({
      staging: "deployed",
      prod: "none",
    });
    expect(board.moreBuilds).toBe(false);
  });

  it("should return no more builds than asked for, and say there are more", async () => {
    const service = aService();
    const builds = ["a", "b", "c"].map((id, i) =>
      aBuild(service, id, { createdAt: at(`2026-11-0${i + 1}T00:00:00Z`) }),
    );
    const workspace = new FakeWorkspace([service], builds);

    const board = (await getReleaseBoardTool(workspace, workspace).run(caller, {
      serviceId: service._id.toString(),
      limit: 2,
    })) as Board;

    expect(board.builds.map((b) => b.buildId)).toEqual(["c", "b"]);
    expect(board.moreBuilds).toBe(true);
  });

  it("should still report what is live when that build is older than the ones listed", async () => {
    const service = aService();
    const workspace = new FakeWorkspace(
      [service],
      [
        aBuild(service, "live-and-old", {
          createdAt: at("2026-10-01T00:00:00Z"),
          logs: [
            {
              environment: "prod",
              status: DeploymentStatus.DEPLOYED,
              at: at("2026-10-01T01:00:00Z"),
            },
          ],
        }),
        aBuild(service, "newer", { createdAt: at("2026-11-01T00:00:00Z") }),
      ],
    );

    const board = (await getReleaseBoardTool(workspace, workspace).run(caller, {
      serviceId: service._id.toString(),
      limit: 1,
    })) as Board;

    expect(board.builds.map((b) => b.buildId)).toEqual(["newer"]);
    expect(board.environments[1].live?.buildId).toBe("live-and-old");
  });

  it("should refuse a service that belongs to another account, the same as one that does not exist", async () => {
    const theirs = aService({ accountId: new ObjectId() });
    const workspace = new FakeWorkspace([theirs], []);
    const tool = getReleaseBoardTool(workspace, workspace);

    const forTheirs = tool.run(caller, { serviceId: theirs._id.toString() });
    const forNobody = tool.run(caller, {
      serviceId: new ObjectId().toString(),
    });

    await expect(forTheirs).rejects.toThrow(ToolRefused);
    await expect(forTheirs).rejects.toThrow(/Service not found/);
    await expect(forNobody).rejects.toThrow(/Service not found/);
  });

  it("should refuse something that is not a service id and point to where ids come from", async () => {
    const workspace = new FakeWorkspace();

    await expect(
      getReleaseBoardTool(workspace, workspace).run(caller, {
        serviceId: "web-app",
      }),
    ).rejects.toThrow(/list_services/);
  });
});
