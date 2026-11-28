import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { listFlagsTool, getFlagTool, FlagReader } from "./flags";
import { ToolRefused } from "../tool";
import { FakeWorkspace, aCaller, aService } from "../fakes";
import { Flag } from "../../../repositories/flagRepository";

const caller = aCaller(["flags:read"]);

const flag = (
  serviceId: ObjectId,
  key: string,
  environments: Flag["environments"],
): Flag => ({
  _id: new ObjectId(),
  accountId: caller.accountId,
  serviceId,
  key,
  description: `About ${key}`,
  environments,
  createdAt: new Date("2026-11-01T00:00:00Z"),
  updatedAt: new Date("2026-11-02T00:00:00Z"),
});

const reader = (flags: Flag[]): FlagReader => ({
  listFlags: async () => flags,
  getFlag: async (_account, _service, key) =>
    flags.find((f) => f.key === key) ?? null,
});

const off = { enabled: false, rolloutPercentage: 0, variants: [] };

describe("list_flags", () => {
  it("should need only permission to read flags", () => {
    const tool = listFlagsTool(new FakeWorkspace(), reader([]));

    expect(tool.name).toBe("list_flags");
    expect(tool.requiredScope).toBe("flags:read");
    expect(tool.changes).toBe(false);
  });

  it("should summarise each flag's state in every environment", async () => {
    const service = aService();
    const flags = [
      flag(service._id, "new-checkout", {
        staging: { enabled: true, rolloutPercentage: 100, variants: [] },
        prod: {
          enabled: true,
          rolloutPercentage: 25,
          variants: [],
          targetingRules: [
            {
              conditions: [{ attribute: "plan", operator: "eq", value: "pro" }],
              serve: { enabled: true },
            } as never,
          ],
        },
      }),
    ];

    const result = await listFlagsTool(
      new FakeWorkspace([service]),
      reader(flags),
    ).run(caller, { serviceId: service._id.toString() });

    expect(result).toEqual({
      flags: [
        {
          key: "new-checkout",
          description: "About new-checkout",
          environments: {
            staging: {
              enabled: true,
              rolloutPercentage: 100,
              variants: 0,
              targetingRules: 0,
            },
            prod: {
              enabled: true,
              rolloutPercentage: 25,
              variants: 0,
              targetingRules: 1,
            },
          },
        },
      ],
    });
  });

  it("should refuse a service the key's account does not have", async () => {
    await expect(
      listFlagsTool(new FakeWorkspace(), reader([])).run(caller, {
        serviceId: new ObjectId().toString(),
      }),
    ).rejects.toThrow(ToolRefused);
  });
});

describe("get_flag", () => {
  it("should need only permission to read flags", () => {
    const tool = getFlagTool(new FakeWorkspace(), reader([]));

    expect(tool.name).toBe("get_flag");
    expect(tool.requiredScope).toBe("flags:read");
    expect(tool.changes).toBe(false);
  });

  it("should return one flag's full configuration per environment", async () => {
    const service = aService();
    const prod = {
      enabled: true,
      rolloutPercentage: 50,
      variants: [
        { key: "control", weight: 50 },
        { key: "treatment", weight: 50 },
      ],
      targetingRules: [],
    };
    const flags = [
      flag(service._id, "new-checkout", { staging: off, prod } as never),
    ];

    const result = await getFlagTool(
      new FakeWorkspace([service]),
      reader(flags),
    ).run(caller, {
      serviceId: service._id.toString(),
      key: "new-checkout",
    });

    expect(result).toEqual({
      key: "new-checkout",
      description: "About new-checkout",
      environments: { staging: off, prod },
      updatedAt: new Date("2026-11-02T00:00:00Z"),
    });
  });

  it("should refuse a flag the service does not have, and say where keys come from", async () => {
    const service = aService();

    const attempt = getFlagTool(new FakeWorkspace([service]), reader([])).run(
      caller,
      { serviceId: service._id.toString(), key: "ghost" },
    );

    await expect(attempt).rejects.toThrow(ToolRefused);
    await expect(attempt).rejects.toThrow(/Flag not found: ghost/);
    await expect(attempt).rejects.toThrow(/list_flags/);
  });
});
