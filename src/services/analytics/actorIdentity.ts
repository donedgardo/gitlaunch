/**
 * Who a warehouse event belongs to.
 *
 * `distinctId` is a single opaque column carrying three very different kinds
 * of actor: a logged-in user, an API key acting on a customer's behalf, and an
 * anonymous landing-page visitor. Counting them together produces a "DAU"
 * figure that is mostly marketing traffic, so the kinds are kept separable.
 *
 * Ids are classified by shape rather than by a stored column so the rule also
 * applies to events captured before this existed.
 */

import { AnalyticsContext } from "./analytics";

export type ActorKind = "user" | "machine" | "visitor" | "unknown";

// Prefix marking an id as an API key rather than a person.
export const MACHINE_ACTOR_PREFIX = "apikey:";

// A Mongo ObjectId hex string — how user ids are written to distinctId.
const USER_ID_PATTERN = /^[0-9a-f]{24}$/i;

// A UUID — how the landing page's `gl_vid` visitor cookie is minted.
const VISITOR_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Actor id for an API key, so machine traffic never reads as a person. */
export function machineActor(apiKeyId: string): string {
  return `${MACHINE_ACTOR_PREFIX}${apiKeyId}`;
}

/**
 * Analytics context for an event someone deliberately caused. Every mutating
 * route should pass one: an event with no tenant is invisible to the
 * dashboard, and an event with no actor cannot appear in a funnel.
 */
export function actor(
  accountId: { toString(): string },
  actorId: { toString(): string },
): AnalyticsContext {
  return {
    accountId: accountId.toString(),
    distinctId: actorId.toString(),
  };
}

export function classifyActor(
  distinctId: string | null | undefined,
): ActorKind {
  if (!distinctId) return "unknown";
  if (distinctId.startsWith(MACHINE_ACTOR_PREFIX)) return "machine";
  if (USER_ID_PATTERN.test(distinctId)) return "user";
  if (VISITOR_ID_PATTERN.test(distinctId)) return "visitor";
  return "unknown";
}

/**
 * Mongo `$match` fragment selecting one kind of actor. Keeps the shape rules
 * above as the single source of truth for both in-memory and database
 * classification.
 */
export function actorMatch(kind: ActorKind): Record<string, unknown> {
  const known = {
    machine: { $regex: `^${MACHINE_ACTOR_PREFIX}` },
    user: { $regex: USER_ID_PATTERN },
    visitor: { $regex: VISITOR_ID_PATTERN },
  } as const;

  // "Unknown" is defined as the complement of the known shapes rather than a
  // pattern of its own, so the three rules above stay the only definition.
  if (kind === "unknown") {
    return {
      distinctId: { $nin: [null, ""] },
      $nor: Object.values(known).map((pattern) => ({ distinctId: pattern })),
    };
  }
  return { distinctId: known[kind] };
}
