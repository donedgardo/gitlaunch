import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { InvitationRepository } from "../../../repositories/invitationRepository";
import {
  MembershipRepository,
  MembershipRole,
} from "../../../repositories/membershipRepository";
import { acceptInvitation } from "./acceptInvitation";

describe("acceptInvitation", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let invitations: InvitationRepository;
  let memberships: MembershipRepository;

  const accountId = new ObjectId();

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    invitations = new InvitationRepository(db);
    memberships = new MembershipRepository(db);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("invitations").deleteMany({});
    await db.collection("accountMemberships").deleteMany({});
  });

  async function makeInvite(overrides: Partial<{ expiresAt: Date }> = {}) {
    return invitations.create({
      accountId,
      invitedByUserId: new ObjectId(),
      email: "dev@team.dev",
      role: MembershipRole.Member,
      token: "tok-" + Math.random().toString(36).slice(2),
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60_000),
    });
  }

  it("adds the accepting user to the invited account with the invited role", async () => {
    // Given: a pending invite and a user who follows the link
    const invite = await makeInvite();
    const userId = new ObjectId();

    // When: they accept
    const result = await acceptInvitation(
      invitations,
      memberships,
      invite.token,
      userId,
    );

    // Then: they join the invited account as a member
    expect(result).toEqual({
      ok: true,
      accountId,
      alreadyMember: false,
    });
    const membership = await memberships.findByUserAndAccount(
      userId,
      accountId,
    );
    expect(membership?.role).toBe(MembershipRole.Member);

    // And: the invite is consumed
    const consumed = await invitations.findByToken(invite.token);
    expect(consumed?.status).toBe("accepted");
  });

  it("is idempotent when the user is already a member", async () => {
    // Given: a user already in the account, plus an invite for that account
    const userId = new ObjectId();
    await memberships.create({
      userId,
      accountId,
      role: MembershipRole.Admin,
    });
    const invite = await makeInvite();

    // When: they accept anyway
    const result = await acceptInvitation(
      invitations,
      memberships,
      invite.token,
      userId,
    );

    // Then: no duplicate membership is created; existing role is untouched
    expect(result).toEqual({ ok: true, accountId, alreadyMember: true });
    const all = await memberships.findByAccountId(accountId);
    expect(all).toHaveLength(1);
    expect(all[0].role).toBe(MembershipRole.Admin);
    const consumed = await invitations.findByToken(invite.token);
    expect(consumed?.status).toBe("accepted");
  });

  it("rejects an unknown token", async () => {
    const result = await acceptInvitation(
      invitations,
      memberships,
      "does-not-exist",
      new ObjectId(),
    );
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects an already-used invite", async () => {
    const invite = await makeInvite();
    await invitations.markAccepted(invite._id);

    const result = await acceptInvitation(
      invitations,
      memberships,
      invite.token,
      new ObjectId(),
    );
    expect(result).toEqual({ ok: false, reason: "used" });
  });

  it("rejects and expires an invite past its expiry", async () => {
    const invite = await makeInvite({ expiresAt: new Date(Date.now() - 1000) });

    const result = await acceptInvitation(
      invitations,
      memberships,
      invite.token,
      new ObjectId(),
    );

    expect(result).toEqual({ ok: false, reason: "expired" });
    const marked = await invitations.findByToken(invite.token);
    expect(marked?.status).toBe("expired");
  });
});
