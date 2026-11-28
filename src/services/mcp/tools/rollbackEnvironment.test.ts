import { describe, it, expect } from "vitest";
import { rollbackEnvironmentTool } from "./rollbackEnvironment";
import { ToolRefused } from "../tool";
import {
  FakeDeployer,
  FakeWorkspace,
  aBuild,
  aCaller,
  aService,
  inGoodStanding,
  readOnlyAccount,
} from "../fakes";
import { DeploymentStatus } from "../../service/deploymentStatus";
import { Service } from "../../../repositories/serviceRepository";

const at = (iso: string) => new Date(iso);
const deployable = () => aService({ deployment: { provider: "raw" } as never });

// v1 went live, then v2 replaced it: v2 is live now, v1 was live before.
const v1ThenV2 = (service: Service) => [
  aBuild(service, "v1", {
    createdAt: at("2026-11-01T00:00:00Z"),
    logs: [
      {
        environment: "prod",
        status: DeploymentStatus.DEPLOYED,
        at: at("2026-11-01T01:00:00Z"),
      },
      {
        environment: "prod",
        status: DeploymentStatus.NONE,
        at: at("2026-11-02T01:00:00Z"),
      },
    ],
  }),
  aBuild(service, "v2", {
    createdAt: at("2026-11-02T00:00:00Z"),
    logs: [
      {
        environment: "prod",
        status: DeploymentStatus.DEPLOYED,
        at: at("2026-11-02T01:00:00Z"),
      },
    ],
  }),
];

const run = (
  service: Service,
  builds: ReturnType<typeof aBuild>[],
  options: {
    deployer?: FakeDeployer;
    caller?: ReturnType<typeof aCaller>;
    limits?: typeof inGoodStanding;
    environment?: string;
    reason?: string;
  } = {},
) => {
  const workspace = new FakeWorkspace([service], builds);
  return rollbackEnvironmentTool(
    workspace,
    workspace,
    options.deployer ?? new FakeDeployer(builds),
    options.limits ?? inGoodStanding,
  ).run(options.caller ?? aCaller(["deployments:write"]), {
    serviceId: service._id.toString(),
    environment: options.environment ?? "prod",
    ...(options.reason ? { reason: options.reason } : {}),
  });
};

describe("rollback_environment", () => {
  it("should need permission to deploy, and be marked as changing things", () => {
    const workspace = new FakeWorkspace();
    const tool = rollbackEnvironmentTool(
      workspace,
      workspace,
      new FakeDeployer(),
      inGoodStanding,
    );

    expect(tool.name).toBe("rollback_environment");
    expect(tool.requiredScope).toBe("deployments:write");
    expect(tool.changes).toBe(true);
  });

  it("should send back out the build that was live before the current one", async () => {
    const service = deployable();
    const builds = v1ThenV2(service);
    const deployer = new FakeDeployer(builds);

    const result = await run(service, builds, {
      deployer,
      reason: "checkout errors after v2",
    });

    expect(deployer.asked).toHaveLength(1);
    expect(deployer.asked[0]).toMatchObject({
      buildId: "v1",
      environment: "prod",
      status: DeploymentStatus.DISPATCHING,
      reason: "checkout errors after v2",
    });
    expect(deployer.asked[0].actor).toMatchObject({ via: "mcp" });
    expect(result).toMatchObject({
      environment: "prod",
      rolledBackFrom: "v2",
      buildId: "v1",
      status: "dispatching",
      intent: "rollback",
    });
  });

  it("should go back to the build most recently live, not simply the next oldest", async () => {
    const service = deployable();
    // v1 was live, then v3 skipped over v2 (which never reached prod).
    const builds = [
      aBuild(service, "v1", {
        createdAt: at("2026-11-01T00:00:00Z"),
        logs: [
          {
            environment: "prod",
            status: DeploymentStatus.DEPLOYED,
            at: at("2026-11-01T01:00:00Z"),
          },
          {
            environment: "prod",
            status: DeploymentStatus.NONE,
            at: at("2026-11-03T01:00:00Z"),
          },
        ],
      }),
      aBuild(service, "v2", { createdAt: at("2026-11-02T00:00:00Z") }),
      aBuild(service, "v3", {
        createdAt: at("2026-11-03T00:00:00Z"),
        logs: [
          {
            environment: "prod",
            status: DeploymentStatus.DEPLOYED,
            at: at("2026-11-03T01:00:00Z"),
          },
        ],
      }),
    ];
    const deployer = new FakeDeployer(builds);

    await run(service, builds, { deployer });

    expect(deployer.asked[0].buildId).toBe("v1");
  });

  it("should refuse when nothing is live in the environment", async () => {
    const service = deployable();
    const builds = [aBuild(service, "v1")];
    const deployer = new FakeDeployer(builds);

    const attempt = run(service, builds, { deployer });

    await expect(attempt).rejects.toThrow(ToolRefused);
    await expect(attempt).rejects.toThrow(/Nothing is live in prod/);
    expect(deployer.asked).toEqual([]);
  });

  it("should refuse when no earlier build was ever live there", async () => {
    const service = deployable();
    const builds = [v1ThenV2(service)[1]];
    const deployer = new FakeDeployer(builds);

    const attempt = run(service, builds, { deployer });

    await expect(attempt).rejects.toThrow(ToolRefused);
    await expect(attempt).rejects.toThrow(/No earlier build/);
    expect(deployer.asked).toEqual([]);
  });

  it("should refuse an environment outside the key's list, and roll nothing back", async () => {
    const service = deployable();
    const builds = v1ThenV2(service);
    const deployer = new FakeDeployer(builds);

    const attempt = run(service, builds, {
      deployer,
      caller: aCaller(["deployments:write"], {
        allowedEnvironments: ["staging"],
      }),
    });

    await expect(attempt).rejects.toThrow(
      'This key is not allowed to act on environment "prod".',
    );
    expect(deployer.asked).toEqual([]);
  });

  it("should refuse when the account is read-only", async () => {
    const service = deployable();
    const builds = v1ThenV2(service);
    const deployer = new FakeDeployer(builds);

    await expect(
      run(service, builds, { deployer, limits: readOnlyAccount }),
    ).rejects.toThrow(/read-only/);
    expect(deployer.asked).toEqual([]);
  });

  it("should refuse a service with no deploy pipeline", async () => {
    const service = aService({ deployment: null });
    const builds = v1ThenV2(service);

    await expect(run(service, builds)).rejects.toThrow(/no deploy pipeline/);
  });
});
