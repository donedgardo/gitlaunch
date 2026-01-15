import { OAuthServiceI } from "./interface";
import { UserRecord } from "../../userService/userRecord";

export class MockAuthService implements OAuthServiceI {
  private authorizedEmails: string[] = [];
  private apiKey?: string;

  constructor(authorizedEmails: string[] = []) {
    this.authorizedEmails = authorizedEmails;
  }

  getUser(token?: string): Promise<UserRecord | null> {
    return Promise.resolve(
      token ? { email: "test@email.com", name: "Test Name" } : null,
    );
  }

  isAuthorized(email: string): boolean {
    return this.authorizedEmails.includes(email);
  }

  getOAuthToken(code: string): Promise<{ access_token: string }> {
    return Promise.resolve({ access_token: "" });
  }

  isApiTokenValid(apiKey?: string): boolean {
    return !!apiKey && apiKey === this.apiKey;
  }

  setApiKey(apiKey: string) {
    this.apiKey = apiKey;
  }
}
