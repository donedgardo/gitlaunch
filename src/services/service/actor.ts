import { ObjectId } from "mongodb";
import { DeploymentStatus } from "./deploymentStatus";

/**
 * Who made a change, recorded on the change itself.
 *
 * Two kinds of actor can release software here and they must never be
 * confused: a person signed in to the dashboard, and an API key — a pipeline,
 * a script, or an agent working through the MCP server. A key acts with the
 * authority of whoever created it, so that person is kept alongside
 * (`onBehalfOfUserId`).
 *
 * `name` is a snapshot taken when the change was made. A key renamed or
 * revoked later, or a person who has since left, still reads correctly in the
 * history they wrote.
 *
 * `client` is what an MCP client says it is ("claude-code"). It is a label
 * the caller chose, not an identity: the key is the identity, which is why
 * each agent should hold its own.
 */
export type UserActor = {
  kind: "user";
  userId: ObjectId;
  name: string;
  via: "dashboard";
};

export type ApiKeyActor = {
  kind: "apiKey";
  apiKeyId: ObjectId;
  name: string;
  via: "api" | "mcp";
  onBehalfOfUserId?: ObjectId;
  client?: string;
};

export type Actor = UserActor | ApiKeyActor;

const UNNAMED_KEY = "API key";
const REASON_MAX_LENGTH = 280;

type KeyIdentity = {
  apiKeyId: ObjectId;
  name?: string;
  createdByUserId?: ObjectId;
};

export function apiKeyActor(
  key: KeyIdentity,
  via: ApiKeyActor["via"],
  client?: string,
): ApiKeyActor {
  return {
    kind: "apiKey",
    apiKeyId: key.apiKeyId,
    name: key.name || UNNAMED_KEY,
    via,
    ...(key.createdByUserId ? { onBehalfOfUserId: key.createdByUserId } : {}),
    ...(client ? { client } : {}),
  };
}

/** How an actor reads in a sentence: "deployed by …". */
export function describeActor(actor: Actor): string {
  if (actor.kind === "user") return actor.name;
  if (actor.via === "mcp") {
    return `${actor.name} (${["MCP", actor.client].filter(Boolean).join(", ")})`;
  }
  return `${actor.name} (API key)`;
}

type AttributedLog = {
  environment: string;
  status: DeploymentStatus;
  actor?: Actor;
};

/**
 * Who is responsible for the deployment an environment's history ends with.
 *
 * That is whoever dispatched it — the person or agent who decided this build
 * should go out — not the pipeline that later reported it had landed. Only
 * when nobody dispatched it here (a reporter calling back about a deploy that
 * started elsewhere) is the reporter credited.
 *
 * A dispatch recorded before attribution existed yields undefined: crediting
 * the pipeline for a decision a person made would be worse than saying
 * nothing.
 */
export function shippedBy(
  logs: readonly AttributedLog[] | undefined,
  environment: string,
): Actor | undefined {
  const history = (logs ?? []).filter((l) => l.environment === environment);
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].status === DeploymentStatus.DISPATCHING) {
      return history[i].actor;
    }
  }
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].status === DeploymentStatus.DEPLOYED) {
      return history[i].actor;
    }
  }
  return undefined;
}

/**
 * A stated reason for a change, as free text from a caller. Optional
 * everywhere; trimmed and capped so a history entry stays a history entry.
 */
export function cleanReason(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const reason = raw.trim().slice(0, REASON_MAX_LENGTH);
  return reason || undefined;
}
