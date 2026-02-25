import { test, expect } from "@playwright/test";
import { MongoClient, ObjectId } from "mongodb";
import { authenticateTestUser, TEST_USERS } from "./helpers/auth";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";

const PRO_PLAN_LIMITS = {
  maxRepositories: 10,
  maxServices: 10,
  maxUsers: 5,
  maxEnvironments: 10,
  publicReposOnly: false,
};

const FREE_PLAN_LIMITS = {
  maxRepositories: 3,
  maxServices: 3,
  maxUsers: 1,
  maxEnvironments: 2,
  publicReposOnly: true,
};

async function setAccountState(
  accountId: string,
  fields: Record<string, unknown>,
) {
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const db = client.db("gitlaunch");
    await db
      .collection("accounts")
      .updateOne(
        { _id: new ObjectId(accountId) },
        { $set: { ...fields, updatedAt: new Date() } },
      );
  } finally {
    await client.close();
  }
}

/**
 * Billing Lifecycle E2E Tests
 *
 * Tests trial banners, payment failure grace periods, read-only enforcement,
 * and billing page state. Maps to Phase 4 UAT scenarios 3-11.
 *
 * Tests run serially within each describe block because they share
 * a single MongoDB account and mutate its state via beforeEach.
 */

test.describe("Billing Lifecycle - Trial User", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async () => {
    // Reset trial user to baseline: Pro plan, active trial, no payment failures
    await setAccountState(TEST_USERS.userOnTrial.accountId, {
      plan: "pro",
      planLimits: PRO_PLAN_LIMITS,
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      paymentFailedAt: null,
    });
  });

  test("trial countdown banner shows on dashboard", async ({ page }) => {
    // Given: Account is on Pro trial with 14 days remaining
    await authenticateTestUser(page, TEST_USERS.userOnTrial);

    // When: I visit the dashboard
    await page.goto("/dashboard/billing-trial-service");

    // Then: I see a yellow trial banner with days remaining
    const trialBanner = page.locator(".border-yellow-400");
    await expect(trialBanner).toBeVisible();
    await expect(trialBanner).toContainText(/Trial: \d+ days remaining/);
    await expect(trialBanner.getByRole("link")).toHaveAttribute(
      "href",
      "/settings/billing",
    );
  });

  test("trial expiry auto-downgrades to free plan", async ({ page }) => {
    // Given: Trial expired yesterday
    await setAccountState(TEST_USERS.userOnTrial.accountId, {
      trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    await authenticateTestUser(page, TEST_USERS.userOnTrial);

    // When: I visit the dashboard (triggers trial expiry check)
    await page.goto("/dashboard");

    // Then: Navigate to billing page and verify downgrade to Free
    await page.goto("/settings/billing");
    await expect(page.getByText("Free", { exact: true })).toBeVisible();
    await expect(page.getByText("Free tier")).toBeVisible();
  });

  test("read-only banner shows after downgrade when over limits", async ({
    page,
  }) => {
    // Given: Account is on Free plan with resources exceeding free limits
    await setAccountState(TEST_USERS.userOnTrial.accountId, {
      plan: "free",
      planLimits: FREE_PLAN_LIMITS,
      trialEndsAt: null,
    });

    // Add extra repos to exceed the free limit of 3 (user already has 1)
    const client = new MongoClient(MONGODB_URI);
    try {
      await client.connect();
      const db = client.db("gitlaunch");
      const accountId = new ObjectId(TEST_USERS.userOnTrial.accountId);
      await db.collection("repositories").insertMany([
        {
          _id: new ObjectId(),
          accountId,
          githubRepoId: 300001,
          githubFullName: "test-org/extra-repo-1",
          githubOwner: "test-org",
          githubRepoName: "extra-repo-1",
          isPrivate: false,
          createdAt: new Date(),
        },
        {
          _id: new ObjectId(),
          accountId,
          githubRepoId: 300002,
          githubFullName: "test-org/extra-repo-2",
          githubOwner: "test-org",
          githubRepoName: "extra-repo-2",
          isPrivate: false,
          createdAt: new Date(),
        },
        {
          _id: new ObjectId(),
          accountId,
          githubRepoId: 300003,
          githubFullName: "test-org/extra-repo-3",
          githubOwner: "test-org",
          githubRepoName: "extra-repo-3",
          isPrivate: false,
          createdAt: new Date(),
        },
      ]);
    } finally {
      await client.close();
    }

    await authenticateTestUser(page, TEST_USERS.userOnTrial);

    // When: I visit the dashboard
    await page.goto("/dashboard/billing-trial-service");

    // Then: I see a red read-only banner
    const readOnlyBanner = page.locator(".border-red-400");
    await expect(readOnlyBanner).toBeVisible();
    await expect(readOnlyBanner).toContainText(
      "Your account exceeds Free plan limits",
    );
    await expect(readOnlyBanner).toContainText("Resources are read-only");
    await expect(readOnlyBanner.getByRole("link")).toHaveAttribute(
      "href",
      "/settings/billing",
    );

    // Cleanup: remove the extra repos
    const cleanupClient = new MongoClient(MONGODB_URI);
    try {
      await cleanupClient.connect();
      const db = cleanupClient.db("gitlaunch");
      await db.collection("repositories").deleteMany({
        accountId: new ObjectId(TEST_USERS.userOnTrial.accountId),
        githubRepoId: { $in: [300001, 300002, 300003] },
      });
    } finally {
      await cleanupClient.close();
    }
  });
});

test.describe("Billing Lifecycle - Subscribed User", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async () => {
    // Reset subscription user to baseline: Pro plan, active subscription, no trial, no payment failures
    await setAccountState(TEST_USERS.userWithSubscription.accountId, {
      plan: "pro",
      planLimits: PRO_PLAN_LIMITS,
      trialEndsAt: null,
      stripeCustomerId: "cus_test_billing",
      stripeSubscriptionId: "sub_test_billing",
      paymentFailedAt: null,
    });
  });

  test("subscribed user does not see trial banner", async ({ page }) => {
    // Given: Account has an active Stripe subscription, no trial
    await authenticateTestUser(page, TEST_USERS.userWithSubscription);

    // When: I visit the dashboard
    await page.goto("/dashboard/billing-payment-service");

    // Then: No trial banner is shown
    await expect(page.locator(".border-yellow-400")).not.toBeVisible();

    // And: Billing page shows "Active subscription"
    await page.goto("/settings/billing");
    await expect(page.getByText("Active subscription")).toBeVisible();
  });

  test("payment failure grace period warning on dashboard", async ({
    page,
  }) => {
    // Given: Payment failed recently (within 7-day grace period)
    await setAccountState(TEST_USERS.userWithSubscription.accountId, {
      paymentFailedAt: new Date(),
    });

    await authenticateTestUser(page, TEST_USERS.userWithSubscription);

    // When: I visit the dashboard
    await page.goto("/dashboard/billing-payment-service");

    // Then: I see a red payment failure banner with grace period days
    const paymentBanner = page.locator(".border-red-500");
    await expect(paymentBanner).toBeVisible();
    await expect(paymentBanner).toContainText("Payment failed");
    await expect(paymentBanner).toContainText(/\d+ days/);
    await expect(paymentBanner.getByRole("link")).toHaveAttribute(
      "href",
      "/settings/billing",
    );
  });

  test("billing page shows payment failure with update button", async ({
    page,
  }) => {
    // Given: Payment failed recently
    await setAccountState(TEST_USERS.userWithSubscription.accountId, {
      paymentFailedAt: new Date(),
    });

    await authenticateTestUser(page, TEST_USERS.userWithSubscription);

    // When: I visit the billing page
    await page.goto("/settings/billing");

    // Then: I see the payment failure section
    await expect(
      page.getByRole("heading", { name: "Payment Failed" }),
    ).toBeVisible();
    await expect(page.getByText(/days remaining/)).toBeVisible();

    // And: I see the "Update Payment Method" button
    await expect(
      page.getByRole("button", { name: "Update Payment Method" }),
    ).toBeVisible();
  });

  test("grace period expiry restricts access", async ({ page }) => {
    // Given: Payment failed 8 days ago (past 7-day grace period)
    await setAccountState(TEST_USERS.userWithSubscription.accountId, {
      paymentFailedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });

    await authenticateTestUser(page, TEST_USERS.userWithSubscription);

    // When: I visit the dashboard
    await page.goto("/dashboard/billing-payment-service");

    // Then: I see the restricted access banner (no days remaining)
    const paymentBanner = page.locator(".border-red-500");
    await expect(paymentBanner).toBeVisible();
    await expect(paymentBanner).toContainText("Payment failed");
    await expect(paymentBanner).toContainText("Your access is restricted");
  });

  test("payment failure banner takes priority over trial banner", async ({
    page,
  }) => {
    // Given: Account has BOTH a payment failure AND an active trial
    await setAccountState(TEST_USERS.userWithSubscription.accountId, {
      paymentFailedAt: new Date(),
      trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    await authenticateTestUser(page, TEST_USERS.userWithSubscription);

    // When: I visit the dashboard
    await page.goto("/dashboard/billing-payment-service");

    // Then: Payment failure banner is shown (higher priority)
    const paymentBanner = page.locator(".border-red-500");
    await expect(paymentBanner).toBeVisible();
    await expect(paymentBanner).toContainText("Payment failed");

    // And: Trial banner is NOT shown (lower priority, template uses else-if)
    await expect(page.locator(".border-yellow-400")).not.toBeVisible();
  });

  test("API blocks build creation when account is read-only", async ({
    request,
  }) => {
    // Given: Payment failed 8 days ago (past grace period, account is read-only)
    await setAccountState(TEST_USERS.userWithSubscription.accountId, {
      paymentFailedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });

    const serviceId = "000000000000000000000211";
    const apiKey = "pk_test-account-billing-payment_testkey123";

    // When: I try to create a build via API
    const response = await request.post(
      `http://localhost:3051/api/v1/services/${serviceId}/builds`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        data: { buildId: `blocked-build-${Date.now()}` },
      },
    );

    // Then: I get a 403 with read-only error
    expect(response.status()).toBe(403);
    const body = await response.json();
    expect(body.error).toContain("read-only");
  });
});
