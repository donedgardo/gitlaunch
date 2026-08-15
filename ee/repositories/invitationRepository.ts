// GitLaunch Enterprise Feature — licensed under LICENSE-enterprise.md, not the FSL.

import { Db, ObjectId, Collection } from "mongodb";
import { MembershipRole } from "../../src/repositories/membershipRepository";

export type InvitationStatus = "pending" | "accepted" | "expired";

export type Invitation = {
  _id: ObjectId;
  accountId: ObjectId;
  invitedByUserId: ObjectId;
  email: string;
  role: MembershipRole;
  token: string;
  status: InvitationStatus;
  expiresAt: Date;
  createdAt: Date;
};

export type CreateInvitationInput = {
  accountId: ObjectId;
  invitedByUserId: ObjectId;
  email: string;
  role: MembershipRole;
  token: string;
  expiresAt: Date;
};

export class InvitationRepository {
  private collection: Collection<Invitation>;

  constructor(db: Db) {
    this.collection = db.collection<Invitation>("invitations");
  }

  async create(input: CreateInvitationInput): Promise<Invitation> {
    const now = new Date();
    const invitation: Omit<Invitation, "_id"> = {
      ...input,
      status: "pending",
      createdAt: now,
    };

    const result = await this.collection.insertOne(invitation as Invitation);
    return { _id: result.insertedId, ...invitation };
  }

  async findByToken(token: string): Promise<Invitation | null> {
    return this.collection.findOne({ token });
  }

  async findPendingByEmail(email: string): Promise<Invitation[]> {
    return this.collection
      .find({ email: email.toLowerCase(), status: "pending" })
      .toArray();
  }

  async findByAccountId(accountId: ObjectId): Promise<Invitation[]> {
    return this.collection.find({ accountId }).toArray();
  }

  async markAccepted(id: ObjectId): Promise<void> {
    await this.collection.updateOne(
      { _id: id },
      { $set: { status: "accepted" } },
    );
  }

  async markExpired(id: ObjectId): Promise<void> {
    await this.collection.updateOne(
      { _id: id },
      { $set: { status: "expired" } },
    );
  }
}
