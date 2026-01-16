import { Db, ObjectId, Collection } from "mongodb";

export type User = {
  _id: ObjectId;
  githubId: number;
  githubLogin: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
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

export class UserRepository {
  private collection: Collection<User>;

  constructor(db: Db) {
    this.collection = db.collection<User>("users");
  }

  async create(input: CreateUserInput): Promise<User> {
    const now = new Date();
    const user: Omit<User, "_id"> = {
      ...input,
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

  async findByEmail(email: string): Promise<User | null> {
    return this.collection.findOne({ email: email.toLowerCase() });
  }

  async findById(id: ObjectId): Promise<User | null> {
    return this.collection.findOne({ _id: id });
  }
}
