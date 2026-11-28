import { ObjectId } from "mongodb";
import { z } from "zod";
import { McpCaller, ToolRefused } from "../tool";
import { Build } from "../../../repositories/buildRepository";
import {
  Actor,
  ApiKeyActor,
  Attribution,
  apiKeyActor,
  cleanReason,
  describeActor,
} from "../../service/actor";
import { mayActOnEnvironment } from "../../apiKey/keyAccess";
import { AccountLimits } from "../../limits/accountPolicy";
import { AccountReadOnly, assertAccountWritable } from "../../limits/writable";

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

// ---- for tools that change something ---------------------------------------

export const reasonInput = z
  .string()
  .optional()
  .describe(
    "Why you are making this change, in a sentence. It is kept on the history next to your key's name, where the team will read it.",
  );

/**
 * Scope says what a key may do; this says where. The same rule, in the same
 * words, as the REST API's requireEnvironmentAccess.
 */
export function requireEnvironmentAccess(
  caller: McpCaller,
  environment: string,
): void {
  if (!mayActOnEnvironment(caller, environment)) {
    throw new ToolRefused(
      `This key is not allowed to act on environment "${environment}".`,
    );
  }
}

export type AccountStanding = Pick<AccountLimits, "getAccountState">;

/** Refuses a change for an account billing has made read-only. */
export async function requireWritableAccount(
  limits: AccountStanding,
  caller: McpCaller,
): Promise<void> {
  try {
    await assertAccountWritable(limits, caller.accountId);
  } catch (error) {
    if (error instanceof AccountReadOnly) throw new ToolRefused(error.message);
    throw error;
  }
}

// A deploy cannot start for a service that only reports builds.
export function requireDeployPipeline(service: ServiceRecord): void {
  if (service.deployment == null) {
    throw new ToolRefused(
      `${service.name} has no deploy pipeline connected, so GitLaunch cannot deploy it. It only reports builds. A person can connect one in the service's settings.`,
    );
  }
}

/** The calling key, as the actor recorded on a change made through MCP. */
export function actorOf(caller: McpCaller): ApiKeyActor {
  return apiKeyActor(caller, "mcp", caller.client);
}

export function attributionOf(
  caller: McpCaller,
  reason: string | undefined,
): Attribution {
  const cleaned = cleanReason(reason);
  return { actor: actorOf(caller), ...(cleaned ? { reason: cleaned } : {}) };
}
