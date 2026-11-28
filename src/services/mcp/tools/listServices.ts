import { ObjectId } from "mongodb";
import { defineTool } from "../tool";

// The little this tool needs from wherever services are kept.
// ServiceRepository satisfies it.
export type ServiceDirectory = {
  findByAccountId(accountId: ObjectId): Promise<
    {
      _id: ObjectId;
      name: string;
      environments: { name: string; order: number }[];
      deployment?: unknown | null;
    }[]
  >;
};

export function listServicesTool(services: ServiceDirectory) {
  return defineTool({
    name: "list_services",
    title: "List services",
    description:
      "List the services in this GitLaunch account, with each service's id and its environments in promotion order (first to last). Start here: every other tool takes a service id from this list. `canDeploy` is false for a service that only reports builds and has no deploy pipeline connected.",
    requiredScope: "services:read",
    changes: false,
    input: {},
    run: async (caller) => {
      const found = await services.findByAccountId(caller.accountId);
      return {
        services: found.map((service) => ({
          id: service._id.toString(),
          name: service.name,
          environments: [...service.environments]
            .sort((a, b) => a.order - b.order)
            .map((e) => e.name),
          canDeploy: service.deployment != null,
        })),
      };
    },
  });
}
