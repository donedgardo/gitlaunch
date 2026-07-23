import { Db, ObjectId, Collection } from "mongodb";

export type User = {
  _id: ObjectId;
  // Provider identities. A user authenticates through one or more of these.
  githubId?: number;
  githubLogin?: string;
  googleId?: string;
  // Email/password identity.
  passwordHash?: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  // Email confirmation. OAuth providers deliver already-verified emails;
  // password signups start unverified until they click the emailed link.
  emailVerified?: boolean;
  emailVerificationToken?: string | null;
  emailVerificationExpiresAt?: Date | null;
  createdAt: Date;
  lastLoginAt: Date;
};

export type CreateUserInput = {
  githubId: number;
  githubLogin: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
};

export type CreateGoogleUserInput = {
  googleId: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
};

export type CreatePasswordUserInput = {
  email: string;
  passwordHash: string;
  name: string | null;
};

export class UserRepository {
  private collection: Collection<User>;

  constructor(db: Db) {
    this.collection = db.collection<User>("users");
  }

  async create(input: CreateUserInput): Promise<User> {
    const now = new Date();
    const user: Omit<User, "_id"> = {
      ...input,
      emailVerified: true, // GitHub only returns verified emails
      createdAt: now,
      lastLoginAt: now,
    };

    const result = await this.collection.insertOne(user as User);
    return { _id: result.insertedId, ...user };
  }

  async findByGitHubId(githubId: number): Promise<User | null> {
    return this.collection.findOne({ githubId });
  }

  async findOrCreateByGitHubId(input: CreateUserInput): Promise<User> {
    const existing = await this.findByGitHubId(input.githubId);

    if (existing) {
      // Update lastLoginAt and return existing user
      const now = new Date();
      await this.collection.updateOne(
        { _id: existing._id },
        { $set: { lastLoginAt: now } },
      );
      return { ...existing, lastLoginAt: now };
    }

    return this.create(input);
  }

  // Alias for findOrCreateByGitHubId
  async findOrCreate(input: CreateUserInput): Promise<User> {
    return this.findOrCreateByGitHubId(input);
  }

  async findByGoogleId(googleId: string): Promise<User | null> {
    return this.collection.findOne({ googleId });
  }

  async findOrCreateByGoogleId(input: CreateGoogleUserInput): Promise<User> {
    const existing = await this.findByGoogleId(input.googleId);

    if (existing) {
      const now = new Date();
      await this.collection.updateOne(
        { _id: existing._id },
        { $set: { lastLoginAt: now } },
      );
      return { ...existing, lastLoginAt: now };
    }

    const now = new Date();
    const user: Omit<User, "_id"> = {
      googleId: input.googleId,
      email: input.email ? input.email.toLowerCase() : null,
      name: input.name,
      avatarUrl: input.avatarUrl,
      emailVerified: true, // Google only returns verified emails
      createdAt: now,
      lastLoginAt: now,
    };

    const result = await this.collection.insertOne(user as User);
    return { _id: result.insertedId, ...user };
  }

  async createPasswordUser(input: CreatePasswordUserInput): Promise<User> {
    const now = new Date();
    const user: Omit<User, "_id"> = {
      email: input.email.toLowerCase(),
      name: input.name,
      avatarUrl: null,
      passwordHash: input.passwordHash,
      emailVerified: false,
      createdAt: now,
      lastLoginAt: now,
    };

    const result = await this.collection.insertOne(user as User);
    return { _id: result.insertedId, ...user };
  }

  async setEmailVerificationToken(
    userId: ObjectId,
    token: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.collection.updateOne(
      { _id: userId },
      {
        $set: {
          emailVerificationToken: token,
          emailVerificationExpiresAt: expiresAt,
        },
      },
    );
  }

  async findByEmailVerificationToken(token: string): Promise<User | null> {
    return this.collection.findOne({ emailVerificationToken: token });
  }

  async markEmailVerified(userId: ObjectId): Promise<void> {
    await this.collection.updateOne(
      { _id: userId },
      {
        $set: { emailVerified: true, lastLoginAt: new Date() },
        $unset: { emailVerificationToken: "", emailVerificationExpiresAt: "" },
      },
    );
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.collection.findOne({ email: email.toLowerCase() });
  }

  async findById(id: ObjectId): Promise<User | null> {
    return this.collection.findOne({ _id: id });
  }
}
