import { ObjectId } from "mongodb";
import { z } from "zod";
import { McpCaller, ToolRefused } from "../tool";
import { Build } from "../../../repositories/buildRepository";
import { Actor, describeActor } from "../../service/actor";

/**
 * What the tools share: looking a service up for the caller, checking an
 * environment name, and describing who did something. Each tool still states
 * its own ports; these are the rules that must read the same in every one.
 */

export type ServiceRecord = {
  _id: ObjectId;
  name: string;
  environments: { name: string; order: number }[];
  deployment?: unknown | null;
};

// ServiceRepository satisfies this.
export type ServiceLookup = {
  findByAccountAndId(
    accountId: ObjectId,
    serviceId: ObjectId,
  ): Promise<ServiceRecord | null>;
};

// BuildService satisfies this. Builds come back newest first.
export type BuildHistory = {
  getBuilds(accountId: ObjectId, serviceId: ObjectId): Promise<Build[]>;
};

export const serviceIdInput = z
  .string()
  .describe("The service's id, from list_services.");

/**
 * The caller's service, or a refusal. A service in another account is
 * refused in exactly the words used for one that does not exist, so an id
 * cannot be probed for.
 */
export async function requireService(
  services: ServiceLookup,
  caller: McpCaller,
  serviceId: string,
): Promise<ServiceRecord> {
  const notFound = new ToolRefused(
    `Service not found: ${serviceId}. Call list_services for the ids this key can use.`,
  );
  if (!ObjectId.isValid(serviceId)) throw notFound;
  const service = await services.findByAccountAndId(
    caller.accountId,
    new ObjectId(serviceId),
  );
  if (!service) throw notFound;
  return service;
}

/** A service's environment names in promotion order. */
export function environmentNames(service: ServiceRecord): string[] {
  return [...service.environments]
    .sort((a, b) => a.order - b.order)
    .map((e) => e.name);
}

// An unknown environment would otherwise read as an empty history — true of a
// real environment nobody has deployed to, and wrong in a way the caller
// cannot see. Naming the real ones lets an agent correct itself in one step.
export function requireEnvironment(
  service: ServiceRecord,
  environment: string,
): void {
  const names = environmentNames(service);
  if (!names.includes(environment)) {
    throw new ToolRefused(
      `Unknown environment "${environment}". This service has: ${names.join(", ")}.`,
    );
  }
}

/** Who made a change, for a history entry. Empty when that was not recorded. */
export function whoOf(actor: Actor | undefined): { by?: string; via?: string } {
  return actor ? { by: describeActor(actor), via: actor.via } : {};
}
