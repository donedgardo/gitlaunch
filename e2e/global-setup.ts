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
    await db.collection("builds").deleteMany({});

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

    // Create test user WITH GitHub App but NO repositories (for service redirect test)
    const testUser5Id = new ObjectId("000000000000000000000005");
    const testAccount5Id = new ObjectId("000000000000000000000055");

    await db.collection("users").insertOne({
      _id: testUser5Id,
      githubId: 99905,
      githubLogin: "test-user-no-repos",
      email: "test-no-repos@example.com",
      name: "Test User No Repos",
      avatarUrl: null,
      createdAt: new Date(),
      lastLoginAt: new Date(),
    });

    await db.collection("accounts").insertOne({
      _id: testAccount5Id,
      name: "Test Account No Repos",
      slug: "test-account-no-repos",
      plan: "free",
      planLimits: {
        maxRepositories: 1,
        maxUsers: 1,
        publicReposOnly: true,
      },
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      paymentFailedAt: null,
      githubInstallationId: 12348, // Has GitHub App installed
      githubInstallationAccessToken: null,
      githubInstallationTokenExpiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.collection("memberships").insertOne({
      _id: new ObjectId(),
      userId: testUser5Id,
      accountId: testAccount5Id,
      role: "owner",
      createdAt: new Date(),
    });

    // NOTE: No repositories are created for this user

    // Create test user WITH a service (for environment management tests)
    const testUser7Id = new ObjectId("000000000000000000000007");
    const testAccount7Id = new ObjectId("000000000000000000000077");
    const testRepo3Id = new ObjectId("000000000000000000000103");
    const testService3Id = new ObjectId("000000000000000000000203");

    await db.collection("users").insertOne({
      _id: testUser7Id,
      githubId: 99907,
      githubLogin: "test-user-with-service",
      email: "test-with-service@example.com",
      name: "Test User With Service",
      avatarUrl: null,
      createdAt: new Date(),
      lastLoginAt: new Date(),
    });

    await db.collection("accounts").insertOne({
      _id: testAccount7Id,
      name: "Test Account With Service",
      slug: "test-account-with-service",
      plan: "free",
      planLimits: {
        maxRepositories: 3,
        maxUsers: 1,
        publicReposOnly: false,
      },
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      paymentFailedAt: null,
      githubInstallationId: 12350,
      githubInstallationAccessToken: null,
      githubInstallationTokenExpiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.collection("memberships").insertOne({
      _id: new ObjectId(),
      userId: testUser7Id,
      accountId: testAccount7Id,
      role: "owner",
      createdAt: new Date(),
    });

    await db.collection("repositories").insertOne({
      _id: testRepo3Id,
      accountId: testAccount7Id,
      githubRepoId: 200003,
      githubFullName: "test-org/env-test-repo",
      githubOwner: "test-org",
      githubRepoName: "env-test-repo",
      isPrivate: false,
      createdAt: new Date(),
    });

    // Create service with default environments for environment management tests
    await db.collection("services").insertOne({
      _id: testService3Id,
      accountId: testAccount7Id,
      repositoryId: testRepo3Id,
      name: "env-test-service",
      environments: [
        { name: "staging", order: 0 },
        { name: "prod", order: 1 },
      ],
      workflowFile: "deploy.yml",
      eventType: "deployment",
      workflowConfigured: true,
      isActive: true,
      createdAt: new Date(),
    });

    // Add builds for userWithService (enables build table tests)
    await db.collection("builds").insertMany([
      {
        _id: new ObjectId("000000000000000000000301"),
        accountId: testAccount7Id,
        serviceId: testService3Id,
        buildId: "abc123",
        deployments: { staging: "deployed", prod: null },
        createdAt: new Date(),
      },
      {
        _id: new ObjectId("000000000000000000000302"),
        accountId: testAccount7Id,
        serviceId: testService3Id,
        buildId: "def456",
        deployments: { staging: "deployed", prod: "deployed" },
        createdAt: new Date(),
      },
    ]);

    // Create test user WITH multiple services (for navigation tests)
    const testUser6Id = new ObjectId("000000000000000000000006");
    const testAccount6Id = new ObjectId("000000000000000000000066");
    const testRepo2Id = new ObjectId("000000000000000000000102");
    const testService1Id = new ObjectId("000000000000000000000201");
    const testService2Id = new ObjectId("000000000000000000000202");

    await db.collection("users").insertOne({
      _id: testUser6Id,
      githubId: 99906,
      githubLogin: "test-user-with-services",
      email: "test-with-services@example.com",
      name: "Test User With Services",
      avatarUrl: null,
      createdAt: new Date(),
      lastLoginAt: new Date(),
    });

    await db.collection("accounts").insertOne({
      _id: testAccount6Id,
      name: "Test Account With Services",
      slug: "test-account-with-services",
      plan: "free",
      planLimits: {
        maxRepositories: 3,
        maxUsers: 1,
        publicReposOnly: false,
      },
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      paymentFailedAt: null,
      githubInstallationId: 12349,
      githubInstallationAccessToken: null,
      githubInstallationTokenExpiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.collection("memberships").insertOne({
      _id: new ObjectId(),
      userId: testUser6Id,
      accountId: testAccount6Id,
      role: "owner",
      createdAt: new Date(),
    });

    await db.collection("repositories").insertOne({
      _id: testRepo2Id,
      accountId: testAccount6Id,
      githubRepoId: 200002,
      githubFullName: "test-org/multi-service-repo",
      githubOwner: "test-org",
      githubRepoName: "multi-service-repo",
      isPrivate: false,
      createdAt: new Date(),
    });

    // Create two services for navigation testing
    await db.collection("services").insertOne({
      _id: testService1Id,
      accountId: testAccount6Id,
      repositoryId: testRepo2Id,
      name: "frontend",
      environments: [
        { name: "staging", order: 0 },
        { name: "prod", order: 1 },
      ],
      workflowFile: "deploy.yml",
      eventType: "deployment",
      workflowConfigured: true,
      isActive: true,
      createdAt: new Date(),
    });

    await db.collection("services").insertOne({
      _id: testService2Id,
      accountId: testAccount6Id,
      repositoryId: testRepo2Id,
      name: "backend",
      environments: [
        { name: "staging", order: 0 },
        { name: "prod", order: 1 },
      ],
      workflowFile: "deploy.yml",
      eventType: "deployment",
      workflowConfigured: true,
      isActive: true,
      createdAt: new Date(),
    });

    // Add builds for both services (enables deploy button tests after navigation)
    await db.collection("builds").insertMany([
      {
        _id: new ObjectId("000000000000000000000401"),
        accountId: testAccount6Id,
        serviceId: testService1Id,
        buildId: "fe1a2b3c4d5e6f7890abcdef",
        deployments: { staging: "deployed", prod: null },
        createdAt: new Date(),
      },
      {
        _id: new ObjectId("000000000000000000000402"),
        accountId: testAccount6Id,
        serviceId: testService2Id,
        buildId: "be7f8e9d0c1b2a3456789012",
        deployments: { staging: null, prod: null },
        createdAt: new Date(),
      },
    ]);

    console.log("Test data created successfully");
  } finally {
    await client.close();
  }
}
