import { UserRecord } from "../../userService/userRecord";

export interface AuthenticationI {
  getUser(access_token?: string): Promise<UserRecord | null>;
  getOAuthToken(code: string): Promise<{ access_token: string }>;
  isApiTokenValid(apiKey?: string): boolean;
  setApiKey(apiKey: string): void;
}

export interface AuthorizationI {
  isAuthorized(email: string): boolean;
}

export interface OAuthServiceI extends AuthorizationI, AuthenticationI {}
