import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { McpGate, MCP_FLAG_KEY } from "./mcpGate";
import { FlagEvaluation } from "../flag/flagEvaluator";

const OUR_ACCOUNT = new ObjectId();
const OUR_SERVICE = new ObjectId();

// GitLaunch's own flag service, answering for the one flag the gate reads.
class FakeFlags {
  calls: { key: string; entityKey: string; env: string }[] = [];
  constructor(private result: FlagEvaluation | null | Error) {}
  async evaluateOne(
    _accountId: ObjectId,
    _serviceId: ObjectId,
    envName: string,
    key: string,
    entityKey: string,
  ): Promise<FlagEvaluation | null> {
    this.calls.push({ key, entityKey, env: envName });
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

const services = (found = true) => ({
  findById: async () => (found ? { accountId: OUR_ACCOUNT } : null),
});

const on: FlagEvaluation = {
  key: MCP_FLAG_KEY,
  enabled: true,
  variant: null,
  reason: "rollout",
};
const off: FlagEvaluation = { ...on, enabled: false, reason: "disabled" };

const gate = (
  flags: FakeFlags,
  config: { serviceId?: ObjectId; environment: string } = {
    serviceId: OUR_SERVICE,
    environment: "prod",
  },
  found = true,
) => new McpGate(flags, services(found) as never, config, () => {});

describe("McpGate", () => {
  describe("allows", () => {
    it("should let an account in when the flag is on for it", async () => {
      const customer = new ObjectId();
      const flags = new FakeFlags(on);

      expect(await gate(flags).allows(customer)).toBe(true);
      expect(flags.calls).toEqual([
        { key: "mcp-server", entityKey: customer.toString(), env: "prod" },
      ]);
    });

    it("should keep an account out when the flag is off for it", async () => {
      expect(await gate(new FakeFlags(off)).allows(new ObjectId())).toBe(false);
    });

    it("should stay closed when the flag has not been created", async () => {
      expect(await gate(new FakeFlags(null)).allows(new ObjectId())).toBe(
        false,
      );
    });

    it("should stay closed when GitLaunch's own flags are not configured", async () => {
      const flags = new FakeFlags(on);

      const allowed = await gate(flags, { environment: "prod" }).allows(
        new ObjectId(),
      );

      expect(allowed).toBe(false);
      expect(flags.calls).toEqual([]);
    });

    it("should stay closed when the flag lookup fails", async () => {
      const flags = new FakeFlags(new Error("flag store unavailable"));

      expect(await gate(flags).allows(new ObjectId())).toBe(false);
    });
  });
});
