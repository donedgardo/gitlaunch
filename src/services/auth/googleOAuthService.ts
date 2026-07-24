export type GoogleTokenResponse = {
  access_token: string;
  token_type: string;
  scope: string;
  id_token?: string;
  expires_in?: number;
};

export type GoogleUserResponse = {
  // Google's stable unique identifier for the account.
  sub: string;
  email: string | null;
  email_verified?: boolean;
  name: string | null;
  picture: string | null;
};

// Interface for HTTP client - allows injection of real or fake implementation
export interface IGoogleHttpClient {
  exchangeCodeForToken(code: string): Promise<GoogleTokenResponse>;
  getUserInfo(accessToken: string): Promise<GoogleUserResponse>;
}

export type GoogleOAuthConfig = {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
};

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export class GoogleOAuthService {
  private httpClient: IGoogleHttpClient;
  private config: GoogleOAuthConfig;

  constructor(httpClient: IGoogleHttpClient, config: GoogleOAuthConfig = {}) {
    this.httpClient = httpClient;
    this.config = config;
  }

  async exchangeCodeForToken(code: string): Promise<GoogleTokenResponse> {
    return this.httpClient.exchangeCodeForToken(code);
  }

  async getUserInfo(accessToken: string): Promise<GoogleUserResponse> {
    return this.httpClient.getUserInfo(accessToken);
  }

  getAuthorizationUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId ?? "",
      redirect_uri: this.config.redirectUri ?? "",
      response_type: "code",
      scope: "openid email profile",
    });

    if (state) {
      params.set("state", state);
    }

    return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
  }
}

// HTTP client implementation for production
export class GoogleHttpClient implements IGoogleHttpClient {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;

  constructor(clientId: string, clientSecret: string, redirectUri: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
  }

  async exchangeCodeForToken(code: string): Promise<GoogleTokenResponse> {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: this.redirectUri,
      }).toString(),
    });

    if (!response.ok) {
      throw new Error("Failed to exchange code for token");
    }

    const data = (await response.json()) as
      | GoogleTokenResponse
      | { error: string; error_description?: string };
    if ("error" in data) {
      throw new Error(data.error_description || "Invalid authorization code");
    }

    return data;
  }

  async getUserInfo(accessToken: string): Promise<GoogleUserResponse> {
    const response = await fetch(GOOGLE_USERINFO_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error("Invalid access token");
    }

    return response.json() as Promise<GoogleUserResponse>;
  }
}

// Fake Google OAuth client for local development (USE_FAKE_GOOGLE=true).
// Accepts any authorization code and returns a dev user.
export class FakeGoogleHttpClient implements IGoogleHttpClient {
  async exchangeCodeForToken(_code: string): Promise<GoogleTokenResponse> {
    return {
      access_token: "fake-google-token",
      token_type: "bearer",
      scope: "openid email profile",
    };
  }

  async getUserInfo(_accessToken: string): Promise<GoogleUserResponse> {
    return {
      sub: "fake-google-sub-1",
      email: "dev@localhost",
      email_verified: true,
      name: "Dev Google User",
      picture: null,
    };
  }
}

export type GoogleServicesConfig = {
  useFakes: boolean;
  clientId?: string;
  clientSecret?: string;
  publicUrl?: string;
};

// Factory mirroring createGitHubServices: wires the real or fake HTTP client.
export function createGoogleOAuthService(
  config: GoogleServicesConfig,
): GoogleOAuthService {
  const redirectUri = `${config.publicUrl}/auth/google/callback`;

  if (config.useFakes) {
    console.info("Using fake Google OAuth service (USE_FAKE_GOOGLE=true)");
    return new GoogleOAuthService(new FakeGoogleHttpClient(), {
      clientId: config.clientId,
      redirectUri,
    });
  }

  const httpClient = new GoogleHttpClient(
    config.clientId!,
    config.clientSecret!,
    redirectUri,
  );
  return new GoogleOAuthService(httpClient, {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri,
  });
}
