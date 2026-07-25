import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { planSignupBackfill } from "./signupBackfill";

describe("planSignupBackfill", () => {
  const accountId = new ObjectId();

  const lead = (overrides: Record<string, any> = {}) => ({
    _id: new ObjectId(),
    email: "someone@example.com",
    attribution: {},
    createdAt: new Date("2026-07-24T01:53:54.193Z"),
    ...overrides,
  });

  const signupEvent = (overrides: Record<string, any> = {}) => ({
    _id: new ObjectId(),
    timestamp: new Date("2026-07-24T01:53:54.195Z"),
    properties: {},
    ...overrides,
  });

  it("should capture a lead the warehouse never recorded", () => {
    // Given a lead captured before the warehouse existed
    const orphan = lead({ createdAt: new Date("2026-07-23T05:18:38.331Z") });

    // When I plan the backfill
    const plan = planSignupBackfill({
      leads: [orphan],
      events: [],
      accountId,
    });

    // Then a signup event is created for them, stamped with the lead it came
    // from so this can never drift again
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].timestamp).toEqual(orphan.createdAt);
    expect(plan.inserts[0].properties.leadId).toBe(orphan._id.toString());
    expect(plan.inserts[0].accountId).toEqual(accountId);
  });

  it("should carry the lead's campaign tagging onto the created event", () => {
    // Given an orphaned lead that arrived from a tagged campaign
    const orphan = lead({
      attribution: { source: "dm", medium: "whatsapp", campaign: "alpha" },
    });

    // When I plan the backfill
    const plan = planSignupBackfill({ leads: [orphan], events: [], accountId });

    // Then the attribution travels with it, so campaign reporting sees it
    expect(plan.inserts[0].properties).toMatchObject({
      source: "dm",
      medium: "whatsapp",
      campaign: "alpha",
    });
  });

  it("should not duplicate a signup already stamped with the lead", () => {
    // Given a lead whose event already names it
    const known = lead();
    const events = [
      signupEvent({
        accountId,
        distinctId: "visitor-1",
        properties: { leadId: known._id.toString() },
        // Deliberately far from the lead's timestamp: the stamp is what counts.
        timestamp: new Date("2026-07-30T00:00:00Z"),
      }),
    ];

    // When I plan the backfill
    const plan = planSignupBackfill({ leads: [known], events, accountId });

    // Then nothing is created
    expect(plan.inserts).toHaveLength(0);
  });

  it("should not duplicate a signup captured at the same moment as the lead", () => {
    // Given an older event with no leadId, written milliseconds after the lead
    const known = lead();
    const events = [signupEvent({ accountId, distinctId: "visitor-1" })];

    // When I plan the backfill
    const plan = planSignupBackfill({ leads: [known], events, accountId });

    // Then it is recognised as the same signup rather than duplicated
    expect(plan.inserts).toHaveLength(0);
  });

  it("should attach the tenant to a signup that was captured without one", () => {
    // Given a matched event that carries no accountId
    const known = lead();
    const orphanEvent = signupEvent();
    const events = [orphanEvent];

    // When I plan the backfill
    const plan = planSignupBackfill({ leads: [known], events, accountId });

    // Then the event is updated in place so tenant-scoped queries can see it
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]._id).toEqual(orphanEvent._id);
    expect(plan.updates[0].set.accountId).toEqual(accountId);
    expect(plan.updates[0].set["properties.leadId"]).toBe(known._id.toString());
  });

  it("should give an unattributed signup an actor derived from its lead", () => {
    // Given a matched event with no distinctId at all
    const known = lead();
    const events = [signupEvent({ accountId })];

    // When I plan the backfill
    const plan = planSignupBackfill({ leads: [known], events, accountId });

    // Then it gets a stable, non-personal actor id
    expect(plan.updates[0].set.distinctId).toBe(`lead:${known._id.toString()}`);
  });

  it("should leave a complete signup alone", () => {
    // Given an event that already has everything
    const known = lead();
    const events = [
      signupEvent({
        accountId,
        distinctId: "visitor-1",
        properties: { leadId: known._id.toString() },
      }),
    ];

    // When I plan the backfill
    const plan = planSignupBackfill({ leads: [known], events, accountId });

    // Then there is nothing to do
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
    expect(plan.alreadyCorrect).toBe(1);
  });

  it("should not match two leads to the same event", () => {
    // Given two leads created at almost the same moment but one event
    const first = lead({ createdAt: new Date("2026-07-24T01:53:54.100Z") });
    const second = lead({ createdAt: new Date("2026-07-24T01:53:54.200Z") });
    const events = [signupEvent({ accountId, distinctId: "visitor-1" })];

    // When I plan the backfill
    const plan = planSignupBackfill({
      leads: [first, second],
      events,
      accountId,
    });

    // Then only the unmatched lead produces a new event
    expect(plan.inserts).toHaveLength(1);
  });
});
