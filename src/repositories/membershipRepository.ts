import { Db, ObjectId, Collection } from "mongodb";

export enum MembershipRole {
  Owner = "owner",
  Admin = "admin",
  Member = "member",
}

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

  async findById(id: ObjectId): Promise<AccountMembership | null> {
    return this.collection.findOne({ _id: id });
  }

  async delete(id: ObjectId): Promise<boolean> {
    const result = await this.collection.deleteOne({ _id: id });
    return result.deletedCount === 1;
  }

  async updateRole(
    id: ObjectId,
    newRole: MembershipRole,
  ): Promise<AccountMembership | null> {
    const result = await this.collection.findOneAndUpdate(
      { _id: id },
      { $set: { role: newRole } },
      { returnDocument: "after" },
    );
    return result;
  }

  async countByRoleInAccount(
    accountId: ObjectId,
    role: MembershipRole,
  ): Promise<number> {
    return this.collection.countDocuments({ accountId, role });
  }
}
