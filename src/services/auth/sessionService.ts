import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";

export type SessionPayload = {
  userId: string;
  accountId: string;
};

export type CreateSessionInput = {
  userId: ObjectId;
  accountId: ObjectId;
};

export type SessionServiceOptions = {
  expiresInSeconds?: number;
};

const DEFAULT_EXPIRY_SECONDS = 15 * 60; // 15 minutes

export class SessionService {
  private secret: string;
  private expiresInSeconds: number;

  constructor(secret: string, options: SessionServiceOptions = {}) {
    this.secret = secret;
    this.expiresInSeconds = options.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS;
  }

  createSession(input: CreateSessionInput): string {
    const payload: SessionPayload = {
      userId: input.userId.toString(),
      accountId: input.accountId.toString(),
    };

    return jwt.sign(payload, this.secret, {
      expiresIn: this.expiresInSeconds,
    });
  }

  validateSession(token: string): SessionPayload | null {
    try {
      const decoded = jwt.verify(token, this.secret) as SessionPayload;
      return {
        userId: decoded.userId,
        accountId: decoded.accountId,
      };
    } catch {
      return null;
    }
  }
}
