import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db } from "mongodb";
import { UserRepository } from "./userRepository";

describe("UserRepository", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let repo: UserRepository;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    repo = new UserRepository(db);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("users").deleteMany({});
  });

  describe("create", () => {
    it("should create user with GitHub profile data and return it with ID", async () => {
      // Given: GitHub user profile data
      const input = {
        githubId: 12345,
        githubLogin: "octocat",
        email: "octocat@github.com",
        name: "The Octocat",
        avatarUrl: "https://github.com/images/octocat.png",
      };

      // When: I create the user
      const user = await repo.create(input);

      // Then: I get back a user with the profile data and generated ID
      expect(user._id).toBeDefined();
      expect(user.githubId).toBe(12345);
      expect(user.githubLogin).toBe("octocat");
      expect(user.email).toBe("octocat@github.com");
      expect(user.name).toBe("The Octocat");
      expect(user.avatarUrl).toBe("https://github.com/images/octocat.png");
    });
  });

  describe("findByGitHubId", () => {
    it("should return user when found by GitHub ID", async () => {
      // Given: a user exists with GitHub ID 99999
      await repo.create({
        githubId: 99999,
        githubLogin: "testuser",
        email: "test@example.com",
        name: "Test User",
        avatarUrl: null,
      });

      // When: I look up by GitHub ID
      const user = await repo.findByGitHubId(99999);

      // Then: I find the user
      expect(user).not.toBeNull();
      expect(user!.githubLogin).toBe("testuser");
    });

    it("should return null when user not found", async () => {
      // When: I look up a GitHub ID that doesn't exist
      const user = await repo.findByGitHubId(99999);

      // Then: I get null
      expect(user).toBeNull();
    });
  });

  describe("findOrCreateByGitHubId", () => {
    it("should create new user when GitHub ID does not exist", async () => {
      // Given: no user with GitHub ID 11111 exists
      const input = {
        githubId: 11111,
        githubLogin: "newuser",
        email: "new@example.com",
        name: "New User",
        avatarUrl: null,
      };

      // When: I find-or-create
      const user = await repo.findOrCreateByGitHubId(input);

      // Then: a new user is created
      expect(user._id).toBeDefined();
      expect(user.githubId).toBe(11111);
      expect(user.githubLogin).toBe("newuser");
    });

    it("should return existing user when GitHub ID already exists", async () => {
      // Given: a user with GitHub ID 22222 exists
      const existing = await repo.create({
        githubId: 22222,
        githubLogin: "existinguser",
        email: "existing@example.com",
        name: "Existing User",
        avatarUrl: null,
      });

      // When: I find-or-create with same GitHub ID but different data
      const user = await repo.findOrCreateByGitHubId({
        githubId: 22222,
        githubLogin: "differentlogin",
        email: "different@example.com",
        name: "Different Name",
        avatarUrl: "https://example.com/avatar.png",
      });

      // Then: I get back the existing user (not updated)
      expect(user._id.toString()).toBe(existing._id.toString());
      expect(user.githubLogin).toBe("existinguser"); // Original data preserved
    });

    it("should update lastLoginAt when returning existing user", async () => {
      // Given: a user exists
      const existing = await repo.create({
        githubId: 33333,
        githubLogin: "loginuser",
        email: null,
        name: null,
        avatarUrl: null,
      });
      const originalLoginTime = existing.lastLoginAt;

      // Wait a tiny bit to ensure time difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      // When: I find-or-create
      const user = await repo.findOrCreateByGitHubId({
        githubId: 33333,
        githubLogin: "loginuser",
        email: null,
        name: null,
        avatarUrl: null,
      });

      // Then: lastLoginAt is updated
      expect(user.lastLoginAt.getTime()).toBeGreaterThan(
        originalLoginTime.getTime(),
      );
    });
  });

  describe("findOrCreateByGoogleId", () => {
    it("should create a verified user when Google ID does not exist", async () => {
      // When: a Google user signs in for the first time
      const user = await repo.findOrCreateByGoogleId({
        googleId: "google-sub-1",
        email: "person@gmail.com",
        name: "Person",
        avatarUrl: "https://example.com/p.png",
      });

      // Then: the user is created and treated as email-verified
      expect(user._id).toBeDefined();
      expect(user.googleId).toBe("google-sub-1");
      expect(user.email).toBe("person@gmail.com");
      expect(user.emailVerified).toBe(true);
      expect(user.githubId).toBeUndefined();
    });

    it("should return the existing user on repeat Google sign-in", async () => {
      // Given: a Google user already exists
      const first = await repo.findOrCreateByGoogleId({
        googleId: "google-sub-2",
        email: "repeat@gmail.com",
        name: "Repeat",
        avatarUrl: null,
      });

      // When: they sign in again
      const again = await repo.findOrCreateByGoogleId({
        googleId: "google-sub-2",
        email: "repeat@gmail.com",
        name: "Repeat",
        avatarUrl: null,
      });

      // Then: it's the same user, not a duplicate
      expect(again._id.toString()).toBe(first._id.toString());
      const all = await db.collection("users").find({}).toArray();
      expect(all.length).toBe(1);
    });
  });

  describe("email/password users", () => {
    it("should create an unverified password user with a stored hash", async () => {
      // When: someone signs up with email + password
      const user = await repo.createPasswordUser({
        email: "Signup@Example.com",
        passwordHash: "hashed-value",
        name: "Signup",
      });

      // Then: the account starts unverified and stores the hash + lowercased email
      expect(user.emailVerified).toBe(false);
      expect(user.passwordHash).toBe("hashed-value");
      expect(user.email).toBe("signup@example.com");
    });

    it("should look up a user by email case-insensitively", async () => {
      await repo.createPasswordUser({
        email: "case@example.com",
        passwordHash: "h",
        name: null,
      });

      const found = await repo.findByEmail("CASE@example.com");
      expect(found).not.toBeNull();
      expect(found!.email).toBe("case@example.com");
    });

    it("should verify an email via its confirmation token", async () => {
      // Given: an unverified user with a confirmation token
      const user = await repo.createPasswordUser({
        email: "verify@example.com",
        passwordHash: "h",
        name: null,
      });
      const expiresAt = new Date(Date.now() + 60_000);
      await repo.setEmailVerificationToken(user._id, "tok-123", expiresAt);

      // When: I find the user by the token and mark them verified
      const byToken = await repo.findByEmailVerificationToken("tok-123");
      expect(byToken!._id.toString()).toBe(user._id.toString());

      await repo.markEmailVerified(user._id);

      // Then: they are verified and the token is cleared
      const after = await repo.findById(user._id);
      expect(after!.emailVerified).toBe(true);
      expect(after!.emailVerificationToken ?? null).toBeNull();
      expect(await repo.findByEmailVerificationToken("tok-123")).toBeNull();
    });
  });
});
