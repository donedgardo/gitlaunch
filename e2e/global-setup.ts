import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";

export default async function globalSetup() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db("gitlaunch");

    // Clean up existing test data
    await db.collection("users").deleteMany({ githubLogin: /^test-/ });
    await db.collection("accounts").deleteMany({ slug: /^test-/ });
    await db.collection("memberships").deleteMany({});
    await db.collection("repositories").deleteMany({});
    await db.collection("services").deleteMany({});

    // Create test user without GitHub App
    const testUser1Id = new ObjectId("000000000000000000000001");
    const testAccount1Id = new ObjectId("000000000000000000000011");

    await db.collection("users").insertOne({
      _id: testUser1Id,
      githubId: 99901,
      githubLogin: "test-user-new",
      email: "test-new@example.com",
      name: "Test User New",
      avatarUrl: null,
      createdAt: new Date(),
      lastLoginAt: new Date(),
    });

    await db.collection("accounts").insertOne({
      _id: testAccount1Id,
      name: "Test Account New",
      slug: "test-account-new",
      plan: "free",
      planLimits: {
        maxRepositories: 1,
        maxUsers: 1,
        publicReposOnly: true,
      },
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      paymentFailedAt: null,
      githubInstallationId: null, // No GitHub App installed
      githubInstallationAccessToken: null,
      githubInstallationTokenExpiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.collection("memberships").insertOne({
      _id: new ObjectId(),
      userId: testUser1Id,
      accountId: testAccount1Id,
      role: "owner",
      createdAt: new Date(),
    });

    // Create test user WITH GitHub App
    const testUser2Id = new ObjectId("000000000000000000000002");
    const testAccount2Id = new ObjectId("000000000000000000000022");

    await db.collection("users").insertOne({
      _id: testUser2Id,
      githubId: 99902,
      githubLogin: "test-user-with-app",
      email: "test-with-app@example.com",
      name: "Test User With App",
      avatarUrl: null,
      createdAt: new Date(),
      lastLoginAt: new Date(),
    });

    await db.collection("accounts").insertOne({
      _id: testAccount2Id,
      name: "Test Account With App",
      slug: "test-account-with-app",
      plan: "free",
      planLimits: {
        maxRepositories: 1,
        maxUsers: 1,
        publicReposOnly: true,
      },
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      paymentFailedAt: null,
      githubInstallationId: 12345, // Has GitHub App installed
      githubInstallationAccessToken: null,
      githubInstallationTokenExpiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.collection("memberships").insertOne({
      _id: new ObjectId(),
      userId: testUser2Id,
      accountId: testAccount2Id,
      role: "owner",
      createdAt: new Date(),
    });

    // Create test user WITH GitHub App on PAID plan
    const testUser3Id = new ObjectId("000000000000000000000003");
    const testAccount3Id = new ObjectId("000000000000000000000033");

    await db.collection("users").insertOne({
      _id: testUser3Id,
      githubId: 99903,
      githubLogin: "test-user-paid",
      email: "test-paid@example.com",
      name: "Test User Paid",
      avatarUrl: null,
      createdAt: new Date(),
      lastLoginAt: new Date(),
    });

    await db.collection("accounts").insertOne({
      _id: testAccount3Id,
      name: "Test Account Paid",
      slug: "test-account-paid",
      plan: "paid",
      planLimits: {
        maxRepositories: 5,
        maxUsers: 10,
        publicReposOnly: false,
      },
      stripeCustomerId: "cus_test_paid",
      stripeSubscriptionId: "sub_test_paid",
      paymentFailedAt: null,
      githubInstallationId: 12346, // Has GitHub App installed
      githubInstallationAccessToken: null,
      githubInstallationTokenExpiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.collection("memberships").insertOne({
      _id: new ObjectId(),
      userId: testUser3Id,
      accountId: testAccount3Id,
      role: "owner",
      createdAt: new Date(),
    });

    // Create test user WITH GitHub App AND repositories (for service creation tests)
    const testUser4Id = new ObjectId("000000000000000000000004");
    const testAccount4Id = new ObjectId("000000000000000000000044");
    const testRepo1Id = new ObjectId("000000000000000000000101");

    await db.collection("users").insertOne({
      _id: testUser4Id,
      githubId: 99904,
      githubLogin: "test-user-with-repos",
      email: "test-with-repos@example.com",
      name: "Test User With Repos",
      avatarUrl: null,
      createdAt: new Date(),
      lastLoginAt: new Date(),
    });

    await db.collection("accounts").insertOne({
      _id: testAccount4Id,
      name: "Test Account With Repos",
      slug: "test-account-with-repos",
      plan: "free",
      planLimits: {
        maxRepositories: 3,
        maxUsers: 1,
        publicReposOnly: false,
      },
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      paymentFailedAt: null,
      githubInstallationId: 12347, // Has GitHub App installed
      githubInstallationAccessToken: null,
      githubInstallationTokenExpiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.collection("memberships").insertOne({
      _id: new ObjectId(),
      userId: testUser4Id,
      accountId: testAccount4Id,
      role: "owner",
      createdAt: new Date(),
    });

    // Add a repository for this user
    await db.collection("repositories").insertOne({
      _id: testRepo1Id,
      accountId: testAccount4Id,
      githubRepoId: 200001,
      githubFullName: "test-org/test-repo",
      githubOwner: "test-org",
      githubRepoName: "test-repo",
      isPrivate: false,
      createdAt: new Date(),
    });

    console.log("Test data created successfully");
  } finally {
    await client.close();
  }
}
