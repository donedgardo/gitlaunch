import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import Fastify, { FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import cookie from "@fastify/cookie";
import view from "@fastify/view";
import * as handlebars from "handlebars";
import path from "node:path";
import { UserRepository } from "../../../repositories/userRepository";
import { AccountRepository } from "../../../repositories/accountRepository";
import {
  MembershipRepository,
  MembershipRole,
} from "../../../repositories/membershipRepository";
import { InvitationRepository } from "../../../repositories/invitationRepository";
import { AccountMembershipService } from "../../../services/account/accountMembershipService";
import { TeamManagementService } from "../../../services/account/teamManagementService";
import { SessionService } from "../../../services/auth/sessionService";
import { sessionAuthMiddleware } from "../../middleware/sessionAuth";
import { registerHandlebarsHelpers } from "../../registerHandlebarsHelpers";
import { registerTeamRoutes } from "./team";
import { RecordingAnalytics } from "../../../services/analytics/fakes";

describe("Team Routes", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let analytics: RecordingAnalytics;
  let userRepo: UserRepository;
  let accountRepo: AccountRepository;
  let membershipRepo: MembershipRepository;
  let invitationRepo: InvitationRepository;
  let sessionService: SessionService;

  let accountId: ObjectId;
  let ownerId: ObjectId;
  let memberId: ObjectId;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    registerHandlebarsHelpers();
    sessionService = new SessionService("test-secret");
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  function sessionFor(userId: ObjectId): string {
    return sessionService.createSession({ userId, accountId });
  }

  beforeEach(async () => {
    await db.collection("users").deleteMany({});
    await db.collection("accounts").deleteMany({});
    await db.collection("accountMemberships").deleteMany({});
    await db.collection("invitations").deleteMany({});

    userRepo = new UserRepository(db);
    accountRepo = new AccountRepository(db);
    membershipRepo = new MembershipRepository(db);
    invitationRepo = new InvitationRepository(db);

    const account = await accountRepo.create({ name: "Acme", slug: "acme" });
    accountId = account._id;

    const owner = await userRepo.create({
      githubId: 1,
      githubLogin: "owner-ann",
      email: "ann@acme.dev",
      name: "Ann",
      avatarUrl: null,
    });
    ownerId = owner._id;
    await membershipRepo.create({
      userId: ownerId,
      accountId,
      role: MembershipRole.Owner,
    });

    const member = await userRepo.create({
      githubId: 2,
      githubLogin: "member-mo",
      email: "mo@acme.dev",
      name: "Mo",
      avatarUrl: null,
    });
    memberId = member._id;
    await membershipRepo.create({
      userId: memberId,
      accountId,
      role: MembershipRole.Member,
    });

    app = Fastify();
    await app.register(formbody);
    await app.register(cookie, { secret: "test-cookie-secret" });
    await app.register(view, {
      engine: { handlebars },
      root: path.join(__dirname, "../../../templates"),
      options: { partials: { navigation: "/partials/navigation.hbs" } },
    });
    sessionAuthMiddleware(app, sessionService);
    analytics = new RecordingAnalytics();
    registerTeamRoutes(app, {
      publicUrl: "http://localhost:3050",
      teamManagementService: new TeamManagementService(
        membershipRepo,
        invitationRepo,
      ),
      accountMembershipService: new AccountMembershipService(
        membershipRepo,
        accountRepo,
        userRepo,
      ),
      invitationRepository: invitationRepo,
      analytics,
    });
    await app.ready();
  });

  it("shows the current members and an invite form to an owner", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/settings/team",
      cookies: { session: sessionFor(ownerId) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("owner-ann");
    expect(response.body).toContain("member-mo");
    expect(response.body).toContain("Invite by link");
  });

  it("creates a shareable invite link when an owner invites someone", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/settings/team/invite",
      cookies: { session: sessionFor(ownerId) },
      payload: { email: "newdev@acme.dev", role: "member" },
    });

    // The page comes back showing the copyable link for the pending invite
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("newdev@acme.dev");
    expect(response.body).toContain("/invite/");

    // And the invitation is persisted as pending with the right role
    const invites = await invitationRepo.findByAccountId(accountId);
    expect(invites).toHaveLength(1);
    expect(invites[0].status).toBe("pending");
    expect(invites[0].role).toBe(MembershipRole.Member);
  });

  it("reports the invite to analytics when an owner invites someone", async () => {
    await app.inject({
      method: "POST",
      url: "/settings/team/invite",
      cookies: { session: sessionFor(ownerId) },
      payload: { email: "newdev@acme.dev", role: "member" },
    });

    // Collaboration is a funnel step, so the event carries tenant and actor —
    // and the invitee's address stays out of it.
    const event = analytics.tracked.find(
      (e) => e.event === "team_member_invited",
    );
    expect(event).toBeDefined();
    expect(event?.context?.accountId).toBe(accountId.toString());
    expect(event?.context?.distinctId).toBe(ownerId.toString());
    expect(event?.properties?.role).toBe(MembershipRole.Member);
    expect(JSON.stringify(event?.properties)).not.toContain("newdev@acme.dev");
  });

  it("reports nothing to analytics when the invite is refused", async () => {
    await app.inject({
      method: "POST",
      url: "/settings/team/invite",
      cookies: { session: sessionFor(memberId) },
      payload: { email: "sneaky@acme.dev", role: "admin" },
    });

    // A rejected attempt is not an invite; counting it would inflate the funnel
    expect(analytics.tracked).toHaveLength(0);
  });

  it("refuses to create an invite for a plain member and stores nothing", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/settings/team/invite",
      cookies: { session: sessionFor(memberId) },
      payload: { email: "sneaky@acme.dev", role: "admin" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.toLowerCase()).toContain("only owners and admins");
    expect(await invitationRepo.findByAccountId(accountId)).toHaveLength(0);
  });

  it("redirects an unauthenticated visitor to sign in", async () => {
    const response = await app.inject({ method: "GET", url: "/settings/team" });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/auth/github");
  });
});
