import { ObjectId } from "mongodb";
import { AccountRepository } from "../../repositories/accountRepository";
import {
  encryptSecret,
  decryptSecret,
  needsReEncryption,
  reEncryptToPrimary,
} from "../crypto/secretBox";

export type ConnectJenkinsInput = {
  accountId: ObjectId;
  baseUrl: string;
  username: string;
  apiToken: string;
};

// Safe view for the UI. There is deliberately no token field — the API token
// is encrypted at rest and never rendered back.
export type JenkinsConnectionView = {
  baseUrl: string;
  username: string;
  connected: true;
  updatedAt: Date;
};

/**
 * Owns the encryption boundary for per-account Jenkins credentials. The API
 * token is encrypted on the way in and only ever decrypted for internal
 * dispatch use (getDecryptedToken) — never for display.
 */
export class JenkinsConnectionService {
  constructor(private accountRepo: AccountRepository) {}

  async connect(input: ConnectJenkinsInput): Promise<void> {
    await this.accountRepo.setJenkinsConnection(input.accountId, {
      baseUrl: input.baseUrl,
      username: input.username,
      apiTokenEncrypted: encryptSecret(input.apiToken),
    });
  }

  async disconnect(accountId: ObjectId): Promise<void> {
    await this.accountRepo.clearJenkinsConnection(accountId);
  }

  async getView(accountId: ObjectId): Promise<JenkinsConnectionView | null> {
    const account = await this.accountRepo.findById(accountId);
    const connection = account?.jenkinsConnection;
    if (!connection) {
      return null;
    }
    return {
      baseUrl: connection.baseUrl,
      username: connection.username,
      connected: true,
      updatedAt: connection.updatedAt,
    };
  }

  /**
   * Decrypts the stored API token for internal use (e.g. dispatching to
   * Jenkins). Not for display. Returns null when no connection exists.
   */
  async getDecryptedToken(accountId: ObjectId): Promise<string | null> {
    const account = await this.accountRepo.findById(accountId);
    const connection = account?.jenkinsConnection;
    if (!connection) {
      return null;
    }
    return decryptSecret(connection.apiTokenEncrypted);
  }

  /**
   * Re-encrypts the stored token under the current primary key if it was
   * encrypted with a rotated-out (or legacy) key. Returns true if it changed.
   * Lets the token migrate to a new key without the user re-entering it.
   */
  async reEncryptStoredToken(accountId: ObjectId): Promise<boolean> {
    const account = await this.accountRepo.findById(accountId);
    const connection = account?.jenkinsConnection;
    if (!connection || !needsReEncryption(connection.apiTokenEncrypted)) {
      return false;
    }
    await this.accountRepo.setJenkinsConnection(accountId, {
      baseUrl: connection.baseUrl,
      username: connection.username,
      apiTokenEncrypted: reEncryptToPrimary(connection.apiTokenEncrypted),
    });
    return true;
  }
}
