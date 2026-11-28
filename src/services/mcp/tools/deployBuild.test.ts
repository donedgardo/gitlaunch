import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { deployBuildTool } from "./deployBuild";
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

const at = (iso: string) => new Date(iso);
const deployable = () => aService({ deployment: { provider: "raw" } as never });

describe("deploy_build", () => {
  it("should need permission to deploy, and be marked as changing things", () => {
    const tool = deployBuildTool(
      new FakeWorkspace(),
      new FakeDeployer(),
      inGoodStanding,
    );

    expect(tool.name).toBe("deploy_build");
    expect(tool.requiredScope).toBe("deployments:write");
    expect(tool.changes).toBe(true);
  });

  it("should dispatch the build to the environment and report it on its way", async () => {
    const service = deployable();
    const deployer = new FakeDeployer([aBuild(service, "v2")]);

    const result = await deployBuildTool(
      new FakeWorkspace([service]),
      deployer,
      inGoodStanding,
    ).run(aCaller(["deployments:write"]), {
      serviceId: service._id.toString(),
      buildId: "v2",
      environment: "staging",
    });

    expect(deployer.asked).toHaveLength(1);
    expect(deployer.asked[0]).toMatchObject({
      serviceId: service._id,
      buildId: "v2",
      environment: "staging",
      status: DeploymentStatus.DISPATCHING,
    });
    expect(result).toMatchObject({
      buildId: "v2",
      environment: "staging",
      status: "dispatching",
      intent: "promote",
    });
  });

  it("should record the deploy against the key, as made through MCP, with the client and the reason", async () => {
    const service = deployable();
    const deployer = new FakeDeployer([aBuild(service, "v2")]);
    const apiKeyId = new ObjectId();
    const createdByUserId = new ObjectId();

    await deployBuildTool(
      new FakeWorkspace([service]),
      deployer,
      inGoodStanding,
    ).run(
      aCaller(["deployments:write"], {
        apiKeyId,
        name: "staging-agent",
        createdByUserId,
        client: "claude-code",
      }),
      {
        serviceId: service._id.toString(),
        buildId: "v2",
        environment: "staging",
        reason: "  verifying the checkout fix ",
      },
    );

    expect(deployer.asked[0].actor).toEqual({
      kind: "apiKey",
      apiKeyId,
      name: "staging-agent",
      via: "mcp",
      onBehalfOfUserId: createdByUserId,
      client: "claude-code",
    });
    expect(deployer.asked[0].reason).toBe("verifying the checkout fix");
  });

  it("should say when sending an older build out is a rollback", async () => {
    const service = deployable();
    const deployer = new FakeDeployer([
      aBuild(service, "v1", { createdAt: at("2026-11-01T00:00:00Z") }),
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
    ]);

    const result = await deployBuildTool(
      new FakeWorkspace([service]),
      deployer,
      inGoodStanding,
    ).run(aCaller(["deployments:write"]), {
      serviceId: service._id.toString(),
      buildId: "v1",
      environment: "prod",
    });

    expect(result).toMatchObject({ intent: "rollback" });
  });

  it("should refuse an environment outside the key's list, and deploy nothing", async () => {
    const service = deployable();
    const deployer = new FakeDeployer([aBuild(service, "v2")]);

    const attempt = deployBuildTool(
      new FakeWorkspace([service]),
      deployer,
      inGoodStanding,
    ).run(
      aCaller(["deployments:write"], { allowedEnvironments: ["staging"] }),
      {
        serviceId: service._id.toString(),
        buildId: "v2",
        environment: "prod",
      },
    );

    await expect(attempt).rejects.toThrow(ToolRefused);
    await expect(attempt).rejects.toThrow(
      'This key is not allowed to act on environment "prod".',
    );
    expect(deployer.asked).toEqual([]);
  });

  it("should deploy to an environment that is on the key's list", async () => {
    const service = deployable();
    const deployer = new FakeDeployer([aBuild(service, "v2")]);

    await deployBuildTool(
      new FakeWorkspace([service]),
      deployer,
      inGoodStanding,
    ).run(
      aCaller(["deployments:write"], { allowedEnvironments: ["staging"] }),
      {
        serviceId: service._id.toString(),
        buildId: "v2",
        environment: "staging",
      },
    );

    expect(deployer.asked).toHaveLength(1);
  });

  it("should refuse an environment the service does not have", async () => {
    const service = deployable();
    const deployer = new FakeDeployer([aBuild(service, "v2")]);

    await expect(
      deployBuildTool(
        new FakeWorkspace([service]),
        deployer,
        inGoodStanding,
      ).run(aCaller(["deployments:write"]), {
        serviceId: service._id.toString(),
        buildId: "v2",
        environment: "production",
      }),
    ).rejects.toThrow(/Unknown environment "production"/);
    expect(deployer.asked).toEqual([]);
  });

  it("should refuse a build the service does not have", async () => {
    const service = deployable();

    const attempt = deployBuildTool(
      new FakeWorkspace([service]),
      new FakeDeployer([]),
      inGoodStanding,
    ).run(aCaller(["deployments:write"]), {
      serviceId: service._id.toString(),
      buildId: "ghost",
      environment: "staging",
    });

    await expect(attempt).rejects.toThrow(ToolRefused);
    await expect(attempt).rejects.toThrow(/Build not found: ghost/);
  });

  it("should refuse a service that only reports builds and has no deploy pipeline", async () => {
    const service = aService({ deployment: null });
    const deployer = new FakeDeployer([aBuild(service, "v2")]);

    const attempt = deployBuildTool(
      new FakeWorkspace([service]),
      deployer,
      inGoodStanding,
    ).run(aCaller(["deployments:write"]), {
      serviceId: service._id.toString(),
      buildId: "v2",
      environment: "staging",
    });

    await expect(attempt).rejects.toThrow(ToolRefused);
    await expect(attempt).rejects.toThrow(/no deploy pipeline/);
    expect(deployer.asked).toEqual([]);
  });

  it("should refuse when the account is read-only, and deploy nothing", async () => {
    const service = deployable();
    const deployer = new FakeDeployer([aBuild(service, "v2")]);

    const attempt = deployBuildTool(
      new FakeWorkspace([service]),
      deployer,
      readOnlyAccount,
    ).run(aCaller(["deployments:write"]), {
      serviceId: service._id.toString(),
      buildId: "v2",
      environment: "staging",
    });

    await expect(attempt).rejects.toThrow(ToolRefused);
    await expect(attempt).rejects.toThrow(/read-only/);
    expect(deployer.asked).toEqual([]);
  });

  it("should not pass a pipeline's failure message on to the agent", async () => {
    const service = deployable();
    const deployer = new FakeDeployer(
      [aBuild(service, "v2")],
      new Error("POST https://ci.internal.example/hook returned 502: secret"),
    );

    const attempt = deployBuildTool(
      new FakeWorkspace([service]),
      deployer,
      inGoodStanding,
    ).run(aCaller(["deployments:write"]), {
      serviceId: service._id.toString(),
      buildId: "v2",
      environment: "staging",
    });

    // A fault, not a refusal: the route reports it to the agent only as one.
    await expect(attempt).rejects.not.toBeInstanceOf(ToolRefused);
  });
});
