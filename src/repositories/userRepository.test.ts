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
});
