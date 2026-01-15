import { beforeEach, describe, expect, it } from "vitest";
import { MockAuthService } from "./mockAuthService";

describe("Auth Service", () => {
  let authService: MockAuthService;
  const authorizedEmails = ["dev@company.com"];
  beforeEach(() => {
    authService = new MockAuthService(authorizedEmails);
  });
  describe("getUser", () => {
    it("returns null if no auth token provided", async () => {
      const user = await authService.getUser(undefined);
      expect(user).toBeNull();
    });
    it("returns an user when auth token provided", async () => {
      const user = await authService.getUser("token");
      expect(user).toBeTruthy();
    });
  });
  describe("isAuthorized", () => {
    it("return false for non authorized user", () => {
      expect(authService.isAuthorized("nonauthorized@company.com")).toBeFalsy();
    });
    it("return true for authorized user", () => {
      expect(authService.isAuthorized("dev@company.com")).toBeTruthy();
    });
  });
});
