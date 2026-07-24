import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import { SelfFlagAccount, describeSelfFlagStatus } from "./selfFlagContext";
import { ServiceRepository } from "../../repositories/serviceRepository";

// A service repo stub standing in for Mongo: we only ever ask it for one
// service by id, so a map of id -> service is a faithful enough fake.
function fakeServices(
  services: Record<string, { accountId: ObjectId }>,
): ServiceRepository {
  return {
    findById: async (id: ObjectId) => services[id.toString()] ?? null,
  } as unknown as ServiceRepository;
}

describe("describeSelfFlagStatus", () => {
  it("should report our own flags inert when no service id is configured", () => {
    // Given GITLAUNCH_SERVICE_ID was never set
    // When we describe the self-flag setup
    const status = describeSelfFlagStatus(undefined, "prod");

    // Then it is not live, and says so in a way an operator can act on
    expect(status.live).toBe(false);
    expect(status.reason).toBe("unset");
    expect(status.message).toContain("GITLAUNCH_SERVICE_ID");
  });

  it("should report our own flags inert when the service id is malformed", () => {
    // Given someone pasted a slug or a URL instead of the service id
    // When we describe the self-flag setup
    const status = describeSelfFlagStatus("my-service", "prod");

    // Then it is not live, and the reason distinguishes this from "unset"
    expect(status.live).toBe(false);
    expect(status.reason).toBe("invalid");
    expect(status.message).toContain("my-service");
  });

  it("should report our own flags live when a valid service id is configured", () => {
    // Given a real service id and a chosen flag environment
    const serviceId = new ObjectId().toString();

    // When we describe the self-flag setup
    const status = describeSelfFlagStatus(serviceId, "staging");

    // Then it is live and names the scope being read
    expect(status.live).toBe(true);
    expect(status.reason).toBe("live");
    expect(status.message).toContain(serviceId);
    expect(status.message).toContain("staging");
  });
});

describe("SelfFlagAccount", () => {
  describe("resolve", () => {
    it("should return the account owning the configured service", async () => {
      // Given a configured service that belongs to an account
      const serviceId = new ObjectId();
      const accountId = new ObjectId();
      const account = new SelfFlagAccount(
        fakeServices({ [serviceId.toString()]: { accountId } }),
        { serviceId, environment: "prod" },
      );

      // When we resolve our own account
      const resolved = await account.resolve();

      // Then we get the owning account back
      expect(resolved?.toString()).toBe(accountId.toString());
    });

    it("should warn once when the configured service does not exist", async () => {
      // Given a service id pointing at a service that isn't there
      const warn = vi.fn();
      const serviceId = new ObjectId();
      const account = new SelfFlagAccount(
        fakeServices({}),
        { serviceId, environment: "prod" },
        warn,
      );

      // When we resolve repeatedly (as every request would)
      await account.resolve();
      await account.resolve();

      // Then the operator is told exactly once, naming the id that missed
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(serviceId.toString());
    });

    it("should not warn when the service resolves", async () => {
      // Given a configured service that exists
      const warn = vi.fn();
      const serviceId = new ObjectId();
      const account = new SelfFlagAccount(
        fakeServices({
          [serviceId.toString()]: { accountId: new ObjectId() },
        }),
        { serviceId, environment: "prod" },
        warn,
      );

      // When we resolve
      await account.resolve();

      // Then nothing is reported
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
