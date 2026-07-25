import { ObjectId } from "mongodb";
import { randomBytes } from "crypto";
import {
  AccountRepository,
  Account,
} from "../../repositories/accountRepository";
import {
  MembershipRepository,
  MembershipRole,
} from "../../repositories/membershipRepository";

export type EnsureAccountParams = {
  userId: ObjectId;
  accountName: string;
  slugSeed: string;
  accountRepository: AccountRepository;
  membershipRepository: MembershipRepository;
};

export type EnsureAccountResult = {
  accountId: ObjectId;
  account: Account | null;
  isNewUser: boolean;
};

// Turns a human-ish seed (github login, email local-part, display name) into a
// URL-safe account slug. Falls back to "account" when the seed has no usable
// characters (e.g. an all-symbol name).
export function slugifyAccountSeed(seed: string): string {
  const slug = seed
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "account";
}

// A newly-authenticated user needs exactly one account + an Owner membership
// before they can reach onboarding. Every login method (GitHub, Google,
// email/password) funnels through here so that bootstrap lives in one place.
// Returns isNewUser=true only when we had to create the account.
export async function ensureAccountForUser(
  params: EnsureAccountParams,
): Promise<EnsureAccountResult> {
  const {
    userId,
    accountName,
    slugSeed,
    accountRepository,
    membershipRepository,
  } = params;

  const memberships = await membershipRepository.findByUserId(userId);
  if (memberships.length > 0) {
    const account = await accountRepository.findById(memberships[0].accountId);
    return { accountId: memberships[0].accountId, account, isNewUser: false };
  }

  const baseSlug = slugifyAccountSeed(slugSeed);
  let account: Account | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    // Slugs are unique per account. On collision, append a short random suffix
    // and retry rather than failing the whole login.
    const slug =
      attempt === 0
        ? baseSlug
        : `${baseSlug}-${randomBytes(2).toString("hex")}`;
    try {
      account = await accountRepository.create({ name: accountName, slug });
      break;
    } catch (error) {
      if (attempt === 4) throw error;
    }
  }

  await membershipRepository.create({
    userId,
    accountId: account!._id,
    role: MembershipRole.Owner,
  });

  return { accountId: account!._id, account, isNewUser: true };
}
