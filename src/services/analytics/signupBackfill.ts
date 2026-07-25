import { ObjectId } from "mongodb";
import { SIGNUP_EVENT } from "./campaignAnalyticsService";

export type LeadRecord = {
  _id: ObjectId;
  email: string;
  attribution?: {
    source?: string | null;
    medium?: string | null;
    campaign?: string | null;
    content?: string | null;
    term?: string | null;
  };
  createdAt: Date;
};

export type SignupEventRecord = {
  _id: ObjectId;
  timestamp: Date;
  accountId?: ObjectId;
  distinctId?: string;
  properties?: Record<string, any>;
};

export type SignupInsert = {
  type: "track";
  event: string;
  timestamp: Date;
  accountId: ObjectId;
  distinctId: string;
  properties: Record<string, any>;
};

export type SignupUpdate = {
  _id: ObjectId;
  set: Record<string, any>;
};

export type BackfillPlan = {
  inserts: SignupInsert[];
  updates: SignupUpdate[];
  alreadyCorrect: number;
};

/**
 * How far apart a lead row and its signup event may be and still be the same
 * signup. Both are written in the same request, milliseconds apart; the window
 * only has to absorb write latency.
 */
const MATCH_WINDOW_MS = 5000;

/** Marks an event created by this reconciliation rather than by live capture. */
export const BACKFILLED_PROPERTY = "backfilled";

/**
 * Reconciles the `leads` collection against the signup events in the
 * warehouse.
 *
 * Leads are the source of truth for "someone joined the waitlist" — the
 * warehouse only started recording signups later, and early events were
 * written without a tenant or an actor. This produces the inserts and updates
 * that make the two agree.
 *
 * Matching prefers an explicit `properties.leadId` stamp; events captured
 * before that stamp existed fall back to timestamp proximity. An event is
 * claimed by at most one lead.
 */
export function planSignupBackfill(params: {
  leads: LeadRecord[];
  events: SignupEventRecord[];
  accountId: ObjectId;
}): BackfillPlan {
  const { leads, events, accountId } = params;

  const byLeadId = new Map<string, SignupEventRecord>();
  for (const event of events) {
    const stamped = event.properties?.leadId;
    if (stamped) byLeadId.set(String(stamped), event);
  }

  const claimed = new Set<string>(
    [...byLeadId.values()].map((e) => e._id.toString()),
  );

  const plan: BackfillPlan = { inserts: [], updates: [], alreadyCorrect: 0 };

  // Oldest first, so when two leads sit inside one window the earlier one
  // claims the event and the later one is treated as genuinely missing.
  const ordered = [...leads].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

  for (const lead of ordered) {
    const match =
      byLeadId.get(lead._id.toString()) ?? claimNearest(lead, events, claimed);

    if (!match) {
      plan.inserts.push(buildInsert(lead, accountId));
      continue;
    }

    const set: Record<string, any> = {};
    if (!match.accountId) set.accountId = accountId;
    if (!match.distinctId) set.distinctId = leadActor(lead);
    if (!match.properties?.leadId) {
      set["properties.leadId"] = lead._id.toString();
    }

    if (Object.keys(set).length === 0) {
      plan.alreadyCorrect++;
    } else {
      plan.updates.push({ _id: match._id, set });
    }
  }

  return plan;
}

function claimNearest(
  lead: LeadRecord,
  events: SignupEventRecord[],
  claimed: Set<string>,
): SignupEventRecord | undefined {
  const candidates = events
    .filter((event) => !claimed.has(event._id.toString()))
    .map((event) => ({
      event,
      distance: Math.abs(event.timestamp.getTime() - lead.createdAt.getTime()),
    }))
    .filter(({ distance }) => distance <= MATCH_WINDOW_MS)
    .sort((a, b) => a.distance - b.distance);

  const nearest = candidates[0]?.event;
  if (nearest) claimed.add(nearest._id.toString());
  return nearest;
}

function buildInsert(lead: LeadRecord, accountId: ObjectId): SignupInsert {
  return {
    type: "track",
    event: SIGNUP_EVENT,
    timestamp: lead.createdAt,
    accountId,
    distinctId: leadActor(lead),
    properties: {
      campaign: lead.attribution?.campaign ?? null,
      source: lead.attribution?.source ?? null,
      medium: lead.attribution?.medium ?? null,
      content: lead.attribution?.content ?? null,
      term: lead.attribution?.term ?? null,
      leadId: lead._id.toString(),
      [BACKFILLED_PROPERTY]: true,
    },
  };
}

// A stable actor id that identifies the signup without storing the email in
// the event stream (the address already lives on the lead and the identify).
function leadActor(lead: LeadRecord): string {
  return `lead:${lead._id.toString()}`;
}
