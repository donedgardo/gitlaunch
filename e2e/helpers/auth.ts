import "dotenv/config";
import { Page } from "@playwright/test";
import jwt from "jsonwebtoken";

const COOKIE_SECRET = process.env.COOKIE_SECRET_SIGNATURE as string;

export type TestUser = {
  userId: string;
  accountId: string;
  hasGitHubApp?: boolean;
};

/**
 * Creates a session token for testing
 */
export function createTestSessionToken(user: TestUser): string {
  return jwt.sign(
    {
      userId: user.userId,
      accountId: user.accountId,
    },
    COOKIE_SECRET,
    { expiresIn: "15m" },
  );
}

/**
 * Authenticates a test user by setting the session cookie
 */
export async function authenticateTestUser(
  page: Page,
  user: TestUser,
): Promise<void> {
  const token = createTestSessionToken(user);

  // Set the session cookie
  await page.context().addCookies([
    {
      name: "session",
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

/**
 * Test user IDs - these would need to exist in the test database
 * For now using placeholder ObjectIds
 */
export const TEST_USERS = {
  // Free plan user without GitHub App
  newUser: {
    userId: "000000000000000000000001",
    accountId: "000000000000000000000011",
    hasGitHubApp: false,
  },
  // Free plan user with GitHub App
  userWithGitHubApp: {
    userId: "000000000000000000000002",
    accountId: "000000000000000000000022",
    hasGitHubApp: true,
  },
  // Paid plan user with GitHub App
  paidUserWithGitHubApp: {
    userId: "000000000000000000000003",
    accountId: "000000000000000000000033",
    hasGitHubApp: true,
  },
  // User with GitHub App AND repositories (for service creation)
  userWithRepos: {
    userId: "000000000000000000000004",
    accountId: "000000000000000000000044",
    hasGitHubApp: true,
  },
  // User with GitHub App but NO repositories (for testing redirect to onboarding)
  userWithGitHubAppNoRepos: {
    userId: "000000000000000000000005",
    accountId: "000000000000000000000055",
    hasGitHubApp: true,
  },
  // User with multiple services (for navigation tests)
  userWithMultipleServices: {
    userId: "000000000000000000000006",
    accountId: "000000000000000000000066",
    hasGitHubApp: true,
  },
  // User with a service (for environment management tests)
  userWithService: {
    userId: "000000000000000000000007",
    accountId: "000000000000000000000077",
    hasGitHubApp: true,
  },
  // Isolated user for build-stream tests (avoids conflicts with parallel tests)
  userForBuildStream: {
    userId: "000000000000000000000008",
    accountId: "000000000000000000000088",
    hasGitHubApp: true,
  },
  // Isolated user for delete-service tests (avoids conflicts with parallel tests)
  userForDeleteService: {
    userId: "000000000000000000000009",
    accountId: "000000000000000000000099",
    hasGitHubApp: true,
  },
};
