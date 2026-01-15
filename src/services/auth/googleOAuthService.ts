import { OAuthServiceI } from "./interface";
import { UserRecord } from "../../userService/userRecord";

export const redirect_uri = `${process.env.PUBLIC_URL}/login/google/callback`;

export class GoogleOAuthService implements OAuthServiceI {
  private apiKey?: string;
  async getUser(access_token?: string): Promise<UserRecord | null> {
    const userInfoResponse = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: {
          Authorization: "Bearer " + access_token,
        },
      },
    );
    const userResponse: any = await userInfoResponse.json();
    return {
      email: userResponse.email,
      name: userResponse.name,
    };
  }

  isAuthorized(email: string): boolean {
    return false;
  }

  async getOAuthToken(code: string) {
    console.log(redirect_uri);
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code: code,
        client_id: process.env.GOOGLE_CLIENT_ID as string,
        client_secret: process.env.GOOGLE_CLIENT_SECRET as string,
        redirect_uri,
        grant_type: "authorization_code",
      }),
    });
    const data: any = await response.json();
    return { access_token: data.access_token };
  }
  isApiTokenValid(apiKey?: string): boolean {
    return !!apiKey && apiKey === this.apiKey;
  }
  setApiKey(apiKey: string) {
    this.apiKey = apiKey;
  }
}
