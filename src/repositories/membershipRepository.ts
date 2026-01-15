import { Db, ObjectId, Collection } from "mongodb";

export type MembershipRole = "owner" | "admin" | "member";

export type AccountMembership = {
  _id: ObjectId;
  userId: ObjectId;
  accountId: ObjectId;
  role: MembershipRole;
  createdAt: Date;
};

export type CreateMembershipInput = {
  userId: ObjectId;
  accountId: ObjectId;
  role: MembershipRole;
};

export class MembershipRepository {
  private collection: Collection<AccountMembership>;

  constructor(db: Db) {
    this.collection = db.collection<AccountMembership>("accountMemberships");
  }

  async create(input: CreateMembershipInput): Promise<AccountMembership> {
    const membership: Omit<AccountMembership, "_id"> = {
      ...input,
      createdAt: new Date(),
    };

    const result = await this.collection.insertOne(
      membership as AccountMembership,
    );
    return { _id: result.insertedId, ...membership };
  }

  async findByUserId(userId: ObjectId): Promise<AccountMembership[]> {
    return this.collection.find({ userId }).toArray();
  }

  async findByAccountId(accountId: ObjectId): Promise<AccountMembership[]> {
    return this.collection.find({ accountId }).toArray();
  }

  async findByUserAndAccount(
    userId: ObjectId,
    accountId: ObjectId,
  ): Promise<AccountMembership | null> {
    return this.collection.findOne({ userId, accountId });
  }
}
