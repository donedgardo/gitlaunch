import { describe, it, expect } from "vitest";
import {
  GoogleOAuthService,
  FakeGoogleHttpClient,
  createGoogleOAuthService,
} from "./googleOAuthService";

describe("GoogleOAuthService", () => {
  describe("getAuthorizationUrl", () => {
    it("should build a Google consent URL with client id, scope and state", () => {
      const service = new GoogleOAuthService(new FakeGoogleHttpClient(), {
        clientId: "client-123",
        redirectUri: "http://localhost:3050/auth/google/callback",
      });

      const url = service.getAuthorizationUrl("state-abc");

      expect(url).toContain("https://accounts.google.com/o/oauth2/v2/auth");
      expect(url).toContain("client_id=client-123");
      expect(url).toContain("response_type=code");
      expect(url).toContain("scope=openid+email+profile");
      expect(url).toContain("state=state-abc");
    });
  });

  describe("exchange + getUserInfo (via injected client)", () => {
    it("should return the profile the client provides", async () => {
      const service = new GoogleOAuthService(new FakeGoogleHttpClient());

      const token = await service.exchangeCodeForToken("any-code");
      const user = await service.getUserInfo(token.access_token);

      expect(user.sub).toBe("fake-google-sub-1");
      expect(user.email).toBe("dev@localhost");
    });
  });

  describe("createGoogleOAuthService", () => {
    it("should use the fake client when useFakes is true", async () => {
      const service = createGoogleOAuthService({
        useFakes: true,
        publicUrl: "http://localhost:3050",
      });

      const token = await service.exchangeCodeForToken("code");
      expect(token.access_token).toBe("fake-google-token");
    });
  });
});
