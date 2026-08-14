import { ObjectId } from "mongodb";
import {
  MembershipRepository,
  MembershipRole,
} from "../../repositories/membershipRepository";
import {
  AccountRepository,
  Account,
} from "../../repositories/accountRepository";
import { UserRepository, User } from "../../repositories/userRepository";

export type UserAccountInfo = {
  account: Account;
  role: MembershipRole;
  membershipId: ObjectId;
};

export type AccountMemberInfo = {
  user: User;
  role: MembershipRole;
  membershipId: ObjectId;
};

export class AccountMembershipService {
  constructor(
    private membershipRepo: MembershipRepository,
    private accountRepo: AccountRepository,
    private userRepo: UserRepository,
  ) {}

  async getUserAccounts(userId: ObjectId): Promise<UserAccountInfo[]> {
    const memberships = await this.membershipRepo.findByUserId(userId);

    const results: UserAccountInfo[] = [];
    for (const membership of memberships) {
      const account = await this.accountRepo.findById(membership.accountId);
      if (account) {
        results.push({
          account,
          role: membership.role,
          membershipId: membership._id,
        });
      }
    }

    return results;
  }

  async getAccountMembers(accountId: ObjectId): Promise<AccountMemberInfo[]> {
    const memberships = await this.membershipRepo.findByAccountId(accountId);

    const results: AccountMemberInfo[] = [];
    for (const membership of memberships) {
      const user = await this.userRepo.findById(membership.userId);
      if (user) {
        results.push({
          user,
          role: membership.role,
          membershipId: membership._id,
        });
      }
    }

    return results;
  }

  async getUserRole(
    userId: ObjectId,
    accountId: ObjectId,
  ): Promise<MembershipRole | null> {
    const membership = await this.membershipRepo.findByUserAndAccount(
      userId,
      accountId,
    );
    return membership?.role ?? null;
  }

  async canAccessAccount(
    userId: ObjectId,
    accountId: ObjectId,
  ): Promise<boolean> {
    const membership = await this.membershipRepo.findByUserAndAccount(
      userId,
      accountId,
    );
    return membership !== null;
  }
}
