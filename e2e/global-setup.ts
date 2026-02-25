import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";
import bcrypt from "bcrypt";

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
    await db.collection("apiKeys").deleteMany({});

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

    // Create isolated test user for build-stream tests
    const testUser8Id = new ObjectId("000000000000000000000008");
    const testAccount8Id = new ObjectId("000000000000000000000088");
    const testRepo4Id = new ObjectId("000000000000000000000104");

    await db.collection("users").insertOne({
      _id: testUser8Id,
      githubId: 99908,
      githubLogin: "test-user-build-stream",
      email: "test-build-stream@example.com",
      name: "Test User Build Stream",
      avatarUrl: null,
      createdAt: new Date(),
      lastLoginAt: new Date(),
    });

    await db.collection("accounts").insertOne({
      _id: testAccount8Id,
      name: "Test Account Build Stream",
      slug: "test-account-build-stream",
      plan: "free",
      planLimits: {
        maxRepositories: 3,
        maxUsers: 1,
        publicReposOnly: false,
      },
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      paymentFailedAt: null,
      githubInstallationId: 12351,
      githubInstallationAccessToken: null,
      githubInstallationTokenExpiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.collection("memberships").insertOne({
      _id: new ObjectId(),
      userId: testUser8Id,
      accountId: testAccount8Id,
      role: "owner",
      createdAt: new Date(),
    });

    await db.collection("repositories").insertOne({
      _id: testRepo4Id,
      accountId: testAccount8Id,
      githubRepoId: 200004,
      githubFullName: "test-org/build-stream-repo",
      githubOwner: "test-org",
      githubRepoName: "build-stream-repo",
      isPrivate: false,
      createdAt: new Date(),
    });

    // Create isolated test user for delete-service tests
    const testUser9Id = new ObjectId("000000000000000000000009");
    const testAccount9Id = new ObjectId("000000000000000000000099");
    const testRepo5Id = new ObjectId("000000000000000000000105");

    await db.collection("users").insertOne({
      _id: testUser9Id,
      githubId: 99909,
      githubLogin: "test-user-delete-service",
      email: "test-delete-service@example.com",
      name: "Test User Delete Service",
      avatarUrl: null,
      createdAt: new Date(),
      lastLoginAt: new Date(),
    });

    await db.collection("accounts").insertOne({
      _id: testAccount9Id,
      name: "Test Account Delete Service",
      slug: "test-account-delete-service",
      plan: "free",
      planLimits: {
        maxRepositories: 3,
        maxUsers: 1,
        publicReposOnly: false,
      },
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      paymentFailedAt: null,
      githubInstallationId: 12352,
      githubInstallationAccessToken: null,
      githubInstallationTokenExpiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.collection("memberships").insertOne({
      _id: new ObjectId(),
      userId: testUser9Id,
      accountId: testAccount9Id,
      role: "owner",
      createdAt: new Date(),
    });

    await db.collection("repositories").insertOne({
      _id: testRepo5Id,
      accountId: testAccount9Id,
      githubRepoId: 200005,
      githubFullName: "test-org/delete-service-repo",
      githubOwner: "test-org",
      githubRepoName: "delete-service-repo",
      isPrivate: false,
      createdAt: new Date(),
    });

    // Create test user on TRIAL (for billing lifecycle tests)
    const testUser10Id = new ObjectId("00000000000000000000000a");
    const testAccount10Id = new ObjectId("00000000000000000000001a");
    const testRepo10Id = new ObjectId("000000000000000000000110");
    const testService10Id = new ObjectId("000000000000000000000210");

    await db.collection("users").insertOne({
      _id: testUser10Id,
      githubId: 99910,
      githubLogin: "test-user-billing-trial",
      email: "test-billing-trial@example.com",
      name: "Test User Billing Trial",
      avatarUrl: null,
      createdAt: new Date(),
      lastLoginAt: new Date(),
    });

    await db.collection("accounts").insertOne({
      _id: testAccount10Id,
      name: "Test Account Billing Trial",
      slug: "test-account-billing-trial",
      plan: "pro",
      planLimits: {
        maxRepositories: 10,
        maxServices: 10,
        maxUsers: 5,
        maxEnvironments: 10,
        publicReposOnly: false,
      },
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      paymentFailedAt: null,
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      githubInstallationId: 12360,
      githubInstallationAccessToken: null,
      githubInstallationTokenExpiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.collection("memberships").insertOne({
      _id: new ObjectId(),
      userId: testUser10Id,
      accountId: testAccount10Id,
      role: "owner",
      createdAt: new Date(),
    });

    await db.collection("repositories").insertOne({
      _id: testRepo10Id,
      accountId: testAccount10Id,
      githubRepoId: 200010,
      githubFullName: "test-org/billing-trial-repo",
      githubOwner: "test-org",
      githubRepoName: "billing-trial-repo",
      isPrivate: false,
      createdAt: new Date(),
    });

    await db.collection("services").insertOne({
      _id: testService10Id,
      accountId: testAccount10Id,
      repositoryId: testRepo10Id,
      name: "billing-trial-service",
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

    await db.collection("builds").insertOne({
      _id: new ObjectId("000000000000000000000501"),
      accountId: testAccount10Id,
      serviceId: testService10Id,
      buildId: "billing-trial-build-1",
      deployments: { staging: "deployed", prod: null },
      createdAt: new Date(),
    });

    // Create test user WITH SUBSCRIPTION (for payment failure lifecycle tests)
    const testUser11Id = new ObjectId("00000000000000000000000b");
    const testAccount11Id = new ObjectId("00000000000000000000001b");
    const testRepo11Id = new ObjectId("000000000000000000000111");
    const testService11Id = new ObjectId("000000000000000000000211");

    await db.collection("users").insertOne({
      _id: testUser11Id,
      githubId: 99911,
      githubLogin: "test-user-billing-payment",
      email: "test-billing-payment@example.com",
      name: "Test User Billing Payment",
      avatarUrl: null,
      createdAt: new Date(),
      lastLoginAt: new Date(),
    });

    await db.collection("accounts").insertOne({
      _id: testAccount11Id,
      name: "Test Account Billing Payment",
      slug: "test-account-billing-payment",
      plan: "pro",
      planLimits: {
        maxRepositories: 10,
        maxServices: 10,
        maxUsers: 5,
        maxEnvironments: 10,
        publicReposOnly: false,
      },
      stripeCustomerId: "cus_test_billing",
      stripeSubscriptionId: "sub_test_billing",
      paymentFailedAt: null,
      trialEndsAt: null,
      githubInstallationId: 12361,
      githubInstallationAccessToken: null,
      githubInstallationTokenExpiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.collection("memberships").insertOne({
      _id: new ObjectId(),
      userId: testUser11Id,
      accountId: testAccount11Id,
      role: "owner",
      createdAt: new Date(),
    });

    await db.collection("repositories").insertOne({
      _id: testRepo11Id,
      accountId: testAccount11Id,
      githubRepoId: 200011,
      githubFullName: "test-org/billing-payment-repo",
      githubOwner: "test-org",
      githubRepoName: "billing-payment-repo",
      isPrivate: false,
      createdAt: new Date(),
    });

    await db.collection("services").insertOne({
      _id: testService11Id,
      accountId: testAccount11Id,
      repositoryId: testRepo11Id,
      name: "billing-payment-service",
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

    await db.collection("builds").insertOne({
      _id: new ObjectId("000000000000000000000502"),
      accountId: testAccount11Id,
      serviceId: testService11Id,
      buildId: "billing-payment-build-1",
      deployments: { staging: "deployed", prod: null },
      createdAt: new Date(),
    });

    // Seed an API key for the billing-payment user (for API read-only test)
    const testApiKeyRaw = "pk_test-account-billing-payment_testkey123";
    const testApiKeyHash = await bcrypt.hash(testApiKeyRaw, 10);
    await db.collection("apiKeys").insertOne({
      _id: new ObjectId("000000000000000000000601"),
      accountId: testAccount11Id,
      createdByUserId: testUser11Id,
      name: "billing-test-key",
      keyPrefix: "pk_test-account-billing-payment_testkey1",
      keyHash: testApiKeyHash,
      scopes: [
        "builds:read",
        "builds:write",
        "deployments:write",
        "services:read",
        "services:write",
      ],
      lastUsedAt: null,
      expiresAt: null,
      isRevoked: false,
      createdAt: new Date(),
    });

    console.log("Test data created successfully");
  } finally {
    await client.close();
  }
}
