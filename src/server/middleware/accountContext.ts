import { FastifyRequest, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import { AccountMembershipService } from "../../services/account/accountMembershipService";
import {
  AccountRepository,
  Account,
} from "../../repositories/accountRepository";
import { MembershipRole } from "../../repositories/membershipRepository";

declare module "fastify" {
  interface FastifyRequest {
    account?: Account;
    accountRole?: MembershipRole;
  }
}

export function createAccountContextMiddleware(
  membershipService: AccountMembershipService,
  accountRepo: AccountRepository,
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    if (!user?.userId) {
      // No authenticated user, skip account resolution
      return;
    }

    const accountIdHeader = request.headers["x-account-id"] as
      | string
      | undefined;

    let account: Account | null = null;
    let role: MembershipRole | null = null;

    if (accountIdHeader) {
      // Validate the account ID format
      if (!ObjectId.isValid(accountIdHeader)) {
        return reply.status(400).send({ error: "Invalid account ID format" });
      }

      const accountId = new ObjectId(accountIdHeader);
      account = await accountRepo.findById(accountId);

      if (!account) {
        return reply.status(404).send({ error: "Account not found" });
      }

      // Check if user has access to this account
      const canAccess = await membershipService.canAccessAccount(
        user.userId,
        accountId,
      );
      if (!canAccess) {
        return reply
          .status(403)
          .send({ error: "You are not authorized to access this account" });
      }

      role = await membershipService.getUserRole(user.userId, accountId);
    } else {
      // Default to user's first account
      const userAccounts = await membershipService.getUserAccounts(user.userId);
      if (userAccounts.length > 0) {
        account = userAccounts[0].account;
        role = userAccounts[0].role;
      }
    }

    if (account) {
      request.account = account;
      request.accountRole = role ?? undefined;
    }
  };
}
