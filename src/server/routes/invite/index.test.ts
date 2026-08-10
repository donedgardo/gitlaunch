import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import Fastify, { FastifyInstance } from "fastify";
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
import { SessionService } from "../../../services/auth/sessionService";
import { sessionAuthMiddleware } from "../../middleware/sessionAuth";
import { registerHandlebarsHelpers } from "../../registerHandlebarsHelpers";
import { registerInviteRoutes } from "./index";

describe("Invite Routes", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let userRepo: UserRepository;
  let accountRepo: AccountRepository;
  let membershipRepo: MembershipRepository;
  let invitationRepo: InvitationRepository;
  let sessionService: SessionService;

  let invitedAccountId: ObjectId;

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

  async function makeInvite(role = MembershipRole.Member) {
    return invitationRepo.create({
      accountId: invitedAccountId,
      invitedByUserId: new ObjectId(),
      email: "dev@team.dev",
      role,
      token: "tok-" + Math.random().toString(36).slice(2),
      expiresAt: new Date(Date.now() + 60_000),
    });
  }

  // A signed-in visitor who belongs to some *other* account (their own).
  async function makeVisitor() {
    const user = await userRepo.create({
      githubId: Math.floor(Math.random() * 1e6),
      githubLogin: "visitor",
      email: "v@team.dev",
      name: "V",
      avatarUrl: null,
    });
    const own = await accountRepo.create({ name: "Own", slug: "own" });
    await membershipRepo.create({
      userId: user._id,
      accountId: own._id,
      role: MembershipRole.Owner,
    });
    const session = sessionService.createSession({
      userId: user._id,
      accountId: own._id,
    });
    return { user, session };
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

    const invited = await accountRepo.create({ name: "Acme", slug: "acme" });
    invitedAccountId = invited._id;

    app = Fastify();
    await app.register(cookie, { secret: "test-cookie-secret" });
    await app.register(view, {
      engine: { handlebars },
      root: path.join(__dirname, "../../../templates"),
      options: { partials: { navigation: "/partials/navigation.hbs" } },
    });
    sessionAuthMiddleware(app, sessionService);
    registerInviteRoutes(app, {
      cookieSecure: false,
      publicUrl: "http://localhost:3050",
      invitationRepository: invitationRepo,
      membershipRepository: membershipRepo,
      accountRepository: accountRepo,
      sessionService,
    });
    await app.ready();
  });

  it("shows a signed-in visitor the workspace and an accept button", async () => {
    const invite = await makeInvite();
    const { session } = await makeVisitor();

    const response = await app.inject({
      method: "GET",
      url: `/invite/${invite.token}`,
      cookies: { session },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Acme");
    expect(response.body).toContain(`/invite/${invite.token}/accept`);
  });

  it("unfurls the invite link with the workspace name but keeps it out of search", async () => {
    const invite = await makeInvite();

    const response = await app.inject({
      method: "GET",
      url: `/invite/${invite.token}`,
    });

    // The shared link renders an OpenGraph card naming the workspace, so it
    // previews richly when pasted into Slack / iMessage instead of a bare URL
    expect(response.body).toContain('property="og:title"');
    expect(response.body).toContain("Acme");
    // But an invite token must never be indexed by search engines
    expect(response.body).toContain('name="robots"');
    expect(response.body).toContain("noindex");
  });

  it("adds the visitor to the workspace on accept and lands them in it", async () => {
    const invite = await makeInvite(MembershipRole.Member);
    const { user, session } = await makeVisitor();

    const response = await app.inject({
      method: "POST",
      url: `/invite/${invite.token}/accept`,
      cookies: { session },
    });

    // They're routed into the shared workspace
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/dashboard");

    // And they're now a member of the invited account
    const membership = await membershipRepo.findByUserAndAccount(
      user._id,
      invitedAccountId,
    );
    expect(membership?.role).toBe(MembershipRole.Member);
  });

  it("shows an invalid page for an unknown or used link", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/invite/nope-not-real",
    });
    expect(response.statusCode).toBe(410);
    expect(response.body.toLowerCase()).toContain("no longer valid");
  });

  it("asks a logged-out visitor to sign in and remembers the invite", async () => {
    const invite = await makeInvite();

    const response = await app.inject({
      method: "GET",
      url: `/invite/${invite.token}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Sign in with GitHub");
    // The token is stashed so login can finish the join
    expect(response.cookies.some((c) => c.name === "pending_invite")).toBe(
      true,
    );
  });
});
