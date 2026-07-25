import bcrypt from "bcrypt";

const DEFAULT_SALT_ROUNDS = 12;

// Hashes and verifies user passwords. Wraps bcrypt so callers depend on an
// abstraction (and tests can drop the cost factor for speed).
export class PasswordService {
  private saltRounds: number;

  constructor(saltRounds: number = DEFAULT_SALT_ROUNDS) {
    this.saltRounds = saltRounds;
  }

  async hash(plaintext: string): Promise<string> {
    return bcrypt.hash(plaintext, this.saltRounds);
  }

  async verify(plaintext: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plaintext, hash);
  }
}
