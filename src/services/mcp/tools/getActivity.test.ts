import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { getActivityTool, FlagHistory } from "./getActivity";
import {
  FakeWorkspace,
  aBuild,
  aCaller,
  aService,
  ciKey,
  maria,
} from "../fakes";
import { DeploymentStatus } from "../../service/deploymentStatus";
import { FlagChange } from "../../../repositories/flagChangeRepository";
import { Actor } from "../../service/actor";

const at = (iso: string) => new Date(iso);

const agent: Actor = {
  kind: "apiKey",
  apiKeyId: new ObjectId(),
  name: "staging-agent",
  via: "mcp",
  client: "claude-code",
};

const change = (
  overrides: Partial<FlagChange> & Pick<FlagChange, "at">,
): FlagChange => ({
  _id: new ObjectId(),
  accountId: new ObjectId(),
  serviceId: new ObjectId(),
  flagKey: "new-checkout",
  change: "configured",
  actor: agent,
  ...overrides,
});

// Flag changes newest first, as the repository returns them.
const history = (changes: FlagChange[]): FlagHistory & { limits: number[] } => {
  const limits: number[] = [];
  return {
    limits,
    listByService: async (_account, _service, limit) => {
      limits.push(limit ?? -1);
      return [...changes].sort((a, b) => b.at.getTime() - a.at.getTime());
    },
  };
};

type Activity = {
  events: Record<string, unknown>[];
  flagChangesIncluded: boolean;
};

describe("get_activity", () => {
  it("should need only permission to read builds", () => {
    const tool = getActivityTool(
      new FakeWorkspace(),
      new FakeWorkspace(),
      history([]),
    );

    expect(tool.name).toBe("get_activity");
    expect(tool.requiredScope).toBe("builds:read");
    expect(tool.changes).toBe(false);
  });

  it("should give one timeline of deploys and flag changes, newest first, with who and why", async () => {
    const service = aService();
    const workspace = new FakeWorkspace(
      [service],
      [
        aBuild(service, "v2", {
          logs: [
            {
              environment: "prod",
              status: DeploymentStatus.DISPATCHING,
              at: at("2026-11-27T10:00:00Z"),
              actor: maria,
              intent: "promote",
            },
            {
              environment: "prod",
              status: DeploymentStatus.DEPLOYED,
              at: at("2026-11-27T10:04:00Z"),
              actor: ciKey,
              intent: "promote",
            },
          ],
        }),
      ],
    );
    const flags = history([
      change({
        at: at("2026-11-27T10:10:00Z"),
        environment: "prod",
        before: { enabled: false, rolloutPercentage: 0, variants: [] },
        after: { enabled: true, rolloutPercentage: 100, variants: [] },
        reason: "release new checkout",
      }),
    ]);

    const result = (await getActivityTool(workspace, workspace, flags).run(
      aCaller(["builds:read", "flags:read"]),
      { serviceId: service._id.toString() },
    )) as Activity;

    expect(result.flagChangesIncluded).toBe(true);
    expect(result.events).toEqual([
      {
        at: at("2026-11-27T10:10:00Z"),
        kind: "flag",
        flagKey: "new-checkout",
        change: "configured",
        environment: "prod",
        before: { enabled: false, rolloutPercentage: 0, variants: [] },
        after: { enabled: true, rolloutPercentage: 100, variants: [] },
        by: "staging-agent (MCP, claude-code)",
        via: "mcp",
        reason: "release new checkout",
      },
      {
        at: at("2026-11-27T10:04:00Z"),
        kind: "deploy",
        buildId: "v2",
        environment: "prod",
        status: "deployed",
        intent: "promote",
        by: "ci-pipeline (API key)",
        via: "api",
      },
      {
        at: at("2026-11-27T10:00:00Z"),
        kind: "deploy",
        buildId: "v2",
        environment: "prod",
        status: "dispatching",
        intent: "promote",
        by: "Maria",
        via: "dashboard",
      },
    ]);
  });

  it("should leave flag changes out, and say so, for a key that cannot read flags", async () => {
    const service = aService();
    const workspace = new FakeWorkspace([service], []);
    const flags = history([change({ at: at("2026-11-27T10:10:00Z") })]);

    const result = (await getActivityTool(workspace, workspace, flags).run(
      aCaller(["builds:read"]),
      { serviceId: service._id.toString() },
    )) as Activity;

    expect(result.flagChangesIncluded).toBe(false);
    expect(result.events).toEqual([]);
    expect(flags.limits).toEqual([]);
  });

  it("should not report a build quietly losing its place when another went live", async () => {
    const service = aService();
    const workspace = new FakeWorkspace(
      [service],
      [
        aBuild(service, "v1", {
          logs: [
            {
              environment: "prod",
              status: DeploymentStatus.DEPLOYED,
              at: at("2026-11-26T10:00:00Z"),
              actor: ciKey,
            },
            {
              environment: "prod",
              status: DeploymentStatus.NONE,
              at: at("2026-11-27T10:04:00Z"),
            },
          ],
        }),
      ],
    );

    const result = (await getActivityTool(
      workspace,
      workspace,
      history([]),
    ).run(aCaller(["builds:read"]), {
      serviceId: service._id.toString(),
    })) as Activity;

    expect(result.events.map((e) => e.status)).toEqual(["deployed"]);
  });

  it("should narrow to one environment when asked", async () => {
    const service = aService();
    const workspace = new FakeWorkspace(
      [service],
      [
        aBuild(service, "v1", {
          logs: [
            {
              environment: "staging",
              status: DeploymentStatus.DEPLOYED,
              at: at("2026-11-27T09:00:00Z"),
              actor: ciKey,
            },
            {
              environment: "prod",
              status: DeploymentStatus.DEPLOYED,
              at: at("2026-11-27T10:00:00Z"),
              actor: ciKey,
            },
          ],
        }),
      ],
    );
    const flags = history([
      change({ at: at("2026-11-27T11:00:00Z"), environment: "staging" }),
      change({ at: at("2026-11-27T12:00:00Z"), environment: "prod" }),
    ]);

    const result = (await getActivityTool(workspace, workspace, flags).run(
      aCaller(["builds:read", "flags:read"]),
      { serviceId: service._id.toString(), environment: "prod" },
    )) as Activity;

    expect(result.events.map((e) => [e.kind, e.environment])).toEqual([
      ["flag", "prod"],
      ["deploy", "prod"],
    ]);
  });

  it("should keep a flag being created or deleted when narrowed to an environment, since that reaches all of them", async () => {
    const service = aService();
    const workspace = new FakeWorkspace([service], []);
    const flags = history([
      change({ at: at("2026-11-27T11:00:00Z"), change: "deleted" }),
    ]);

    const result = (await getActivityTool(workspace, workspace, flags).run(
      aCaller(["builds:read", "flags:read"]),
      { serviceId: service._id.toString(), environment: "prod" },
    )) as Activity;

    expect(result.events.map((e) => e.change)).toEqual(["deleted"]);
  });

  it("should return no more events than asked for, keeping the newest", async () => {
    const service = aService();
    const workspace = new FakeWorkspace(
      [service],
      [
        aBuild(service, "v1", {
          logs: [1, 2, 3].map((h) => ({
            environment: "prod",
            status: DeploymentStatus.DEPLOYED,
            at: at(`2026-11-27T0${h}:00:00Z`),
            actor: ciKey,
          })),
        }),
      ],
    );

    const result = (await getActivityTool(
      workspace,
      workspace,
      history([]),
    ).run(aCaller(["builds:read"]), {
      serviceId: service._id.toString(),
      limit: 2,
    })) as Activity;

    expect(result.events.map((e) => e.at)).toEqual([
      at("2026-11-27T03:00:00Z"),
      at("2026-11-27T02:00:00Z"),
    ]);
  });

  it("should leave out deploys recorded before history was dated", async () => {
    const service = aService();
    const undated = aBuild(service, "v0", {
      logs: [
        {
          environment: "prod",
          status: DeploymentStatus.DEPLOYED,
          at: at("2026-01-01T00:00:00Z"),
        },
      ],
    });
    // As stored before entries carried a time.
    delete (undated.deploymentLogs[0] as { at?: Date }).at;
    const workspace = new FakeWorkspace(
      [service],
      [
        undated,
        aBuild(service, "v1", {
          logs: [
            {
              environment: "prod",
              status: DeploymentStatus.DEPLOYED,
              at: at("2026-11-27T02:00:00Z"),
            },
          ],
        }),
      ],
    );

    const result = (await getActivityTool(
      workspace,
      workspace,
      history([]),
    ).run(aCaller(["builds:read"]), {
      serviceId: service._id.toString(),
    })) as Activity;

    expect(result.events.map((e) => e.buildId)).toEqual(["v1"]);
  });

  it("should refuse an environment the service does not have", async () => {
    const service = aService();
    const workspace = new FakeWorkspace([service], []);

    await expect(
      getActivityTool(workspace, workspace, history([])).run(
        aCaller(["builds:read"]),
        { serviceId: service._id.toString(), environment: "production" },
      ),
    ).rejects.toThrow(/Unknown environment "production"/);
  });
});
