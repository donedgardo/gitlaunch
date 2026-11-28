import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { setFlagEnvironmentTool, FlagWriter } from "./setFlagEnvironment";
import { ToolRefused } from "../tool";
import {
  FakeWorkspace,
  aCaller,
  aService,
  inGoodStanding,
  readOnlyAccount,
} from "../fakes";
import { Flag } from "../../../repositories/flagRepository";
import { Attribution } from "../../service/actor";

const off = { enabled: false, rolloutPercentage: 0, variants: [] };

// One service's flags, in memory: reads them and applies a change the way
// FlagService does, remembering who was said to have made it.
class FakeFlags implements FlagWriter {
  writes: { key: string; environment: string; by: Attribution }[] = [];
  constructor(private flags: Flag[]) {}

  async getFlag(_account: ObjectId, _service: ObjectId, key: string) {
    return this.flags.find((f) => f.key === key) ?? null;
  }

  async setEnvConfig(
    _account: ObjectId,
    _service: ObjectId,
    key: string,
    environment: string,
    patch: { enabled?: boolean; rolloutPercentage?: number },
    by: Attribution,
  ): Promise<Flag> {
    const flag = this.flags.find((f) => f.key === key)!;
    this.writes.push({ key, environment, by });
    flag.environments = {
      ...flag.environments,
      [environment]: { ...flag.environments[environment], ...patch },
    };
    return flag;
  }
}

const aFlag = (key = "new-checkout"): Flag => ({
  _id: new ObjectId(),
  accountId: new ObjectId(),
  serviceId: new ObjectId(),
  key,
  description: "",
  environments: { staging: { ...off }, prod: { ...off } },
  createdAt: new Date(),
  updatedAt: new Date(),
});

const writer = aCaller(["flags:write"]);

describe("set_flag_environment", () => {
  it("should need permission to change flags, and be marked as changing things", () => {
    const tool = setFlagEnvironmentTool(
      new FakeWorkspace(),
      new FakeFlags([]),
      inGoodStanding,
    );

    expect(tool.name).toBe("set_flag_environment");
    expect(tool.requiredScope).toBe("flags:write");
    expect(tool.changes).toBe(true);
  });

  it("should switch a flag in one environment and show it before and after", async () => {
    const service = aService();
    const flags = new FakeFlags([aFlag()]);

    const result = await setFlagEnvironmentTool(
      new FakeWorkspace([service]),
      flags,
      inGoodStanding,
    ).run(writer, {
      serviceId: service._id.toString(),
      key: "new-checkout",
      environment: "prod",
      enabled: true,
      rolloutPercentage: 25,
    });

    expect(result).toEqual({
      key: "new-checkout",
      environment: "prod",
      before: { enabled: false, rolloutPercentage: 0 },
      after: { enabled: true, rolloutPercentage: 25 },
    });
  });

  it("should change only what was asked, leaving the rest as it was", async () => {
    const service = aService();
    const flag = aFlag();
    flag.environments.prod = { ...off, enabled: true, rolloutPercentage: 10 };
    const flags = new FakeFlags([flag]);

    const result = await setFlagEnvironmentTool(
      new FakeWorkspace([service]),
      flags,
      inGoodStanding,
    ).run(writer, {
      serviceId: service._id.toString(),
      key: "new-checkout",
      environment: "prod",
      rolloutPercentage: 50,
    });

    expect(result).toMatchObject({
      after: { enabled: true, rolloutPercentage: 50 },
    });
  });

  it("should record the change against the key, as made through MCP, with the reason", async () => {
    const service = aService();
    const flags = new FakeFlags([aFlag()]);
    const apiKeyId = new ObjectId();

    await setFlagEnvironmentTool(
      new FakeWorkspace([service]),
      flags,
      inGoodStanding,
    ).run(
      aCaller(["flags:write"], {
        apiKeyId,
        name: "release-agent",
        client: "claude-code",
      }),
      {
        serviceId: service._id.toString(),
        key: "new-checkout",
        environment: "prod",
        enabled: false,
        reason: "error rate rose after enabling",
      },
    );

    expect(flags.writes).toEqual([
      {
        key: "new-checkout",
        environment: "prod",
        by: {
          actor: {
            kind: "apiKey",
            apiKeyId,
            name: "release-agent",
            via: "mcp",
            client: "claude-code",
          },
          reason: "error rate rose after enabling",
        },
      },
    ]);
  });

  it("should refuse when asked to change nothing", async () => {
    const service = aService();
    const flags = new FakeFlags([aFlag()]);

    const attempt = setFlagEnvironmentTool(
      new FakeWorkspace([service]),
      flags,
      inGoodStanding,
    ).run(writer, {
      serviceId: service._id.toString(),
      key: "new-checkout",
      environment: "prod",
    });

    await expect(attempt).rejects.toThrow(ToolRefused);
    await expect(attempt).rejects.toThrow(/Nothing to change/);
    expect(flags.writes).toEqual([]);
  });

  it("should refuse an environment outside the key's list, and change nothing", async () => {
    const service = aService();
    const flags = new FakeFlags([aFlag()]);

    const attempt = setFlagEnvironmentTool(
      new FakeWorkspace([service]),
      flags,
      inGoodStanding,
    ).run(aCaller(["flags:write"], { allowedEnvironments: ["staging"] }), {
      serviceId: service._id.toString(),
      key: "new-checkout",
      environment: "prod",
      enabled: true,
    });

    await expect(attempt).rejects.toThrow(
      'This key is not allowed to act on environment "prod".',
    );
    expect(flags.writes).toEqual([]);
  });

  it("should refuse a flag the service does not have", async () => {
    const service = aService();
    const flags = new FakeFlags([]);

    const attempt = setFlagEnvironmentTool(
      new FakeWorkspace([service]),
      flags,
      inGoodStanding,
    ).run(writer, {
      serviceId: service._id.toString(),
      key: "ghost",
      environment: "prod",
      enabled: true,
    });

    await expect(attempt).rejects.toThrow(/Flag not found: ghost/);
  });

  it("should refuse an environment the service does not have", async () => {
    const service = aService();
    const flags = new FakeFlags([aFlag()]);

    await expect(
      setFlagEnvironmentTool(
        new FakeWorkspace([service]),
        flags,
        inGoodStanding,
      ).run(writer, {
        serviceId: service._id.toString(),
        key: "new-checkout",
        environment: "production",
        enabled: true,
      }),
    ).rejects.toThrow(/Unknown environment "production"/);
  });

  it("should refuse when the account is read-only, and change nothing", async () => {
    const service = aService();
    const flags = new FakeFlags([aFlag()]);

    await expect(
      setFlagEnvironmentTool(
        new FakeWorkspace([service]),
        flags,
        readOnlyAccount,
      ).run(writer, {
        serviceId: service._id.toString(),
        key: "new-checkout",
        environment: "prod",
        enabled: true,
      }),
    ).rejects.toThrow(/read-only/);
    expect(flags.writes).toEqual([]);
  });
});
