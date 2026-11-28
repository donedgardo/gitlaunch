import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { listServicesTool } from "./listServices";
import { McpCaller } from "../tool";

const accountId = new ObjectId();
const caller: McpCaller = {
  accountId,
  apiKeyId: new ObjectId(),
  scopes: ["services:read"],
};

// The account's services, as the directory would hand them back.
const directory = (services: unknown[]) => {
  const askedFor: ObjectId[] = [];
  return {
    askedFor,
    findByAccountId: async (id: ObjectId) => {
      askedFor.push(id);
      return services as never;
    },
  };
};

describe("list_services", () => {
  it("should need only permission to read services", () => {
    const tool = listServicesTool(directory([]));

    expect(tool.name).toBe("list_services");
    expect(tool.requiredScope).toBe("services:read");
    expect(tool.changes).toBe(false);
  });

  it("should list each service with its environments in promotion order", async () => {
    const serviceId = new ObjectId();
    const tool = listServicesTool(
      directory([
        {
          _id: serviceId,
          name: "web-app",
          environments: [
            { name: "prod", order: 1 },
            { name: "staging", order: 0 },
          ],
          deployment: { provider: "github" },
        },
      ]),
    );

    const result = await tool.run(caller, {});

    expect(result).toEqual({
      services: [
        {
          id: serviceId.toString(),
          name: "web-app",
          environments: ["staging", "prod"],
          canDeploy: true,
        },
      ],
    });
  });

  it("should say when a service only reports builds and cannot be deployed from here", async () => {
    const tool = listServicesTool(
      directory([
        {
          _id: new ObjectId(),
          name: "report-only",
          environments: [{ name: "prod", order: 0 }],
          deployment: null,
        },
      ]),
    );

    const result = (await tool.run(caller, {})) as {
      services: { canDeploy: boolean }[];
    };

    expect(result.services[0].canDeploy).toBe(false);
  });

  it("should ask only for the calling key's own account", async () => {
    const services = directory([]);

    await listServicesTool(services).run(caller, {});

    expect(services.askedFor).toEqual([accountId]);
  });
});
