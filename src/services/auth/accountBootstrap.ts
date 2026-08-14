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
  // How many accounts this instance may hold. Open core is single-tenant, so a
  // self-hosted install without a license passes 1. Omitted means no cap, which
  // is what the hosted product and any licensed install pass.
  maxAccounts?: number;
};

// Raised when a single-tenant instance is asked to bootstrap a second account.
// Its own type so the login routes can tell "this instance is single-tenant"
// apart from a genuine failure and show the person something that makes sense.
export class AccountLimitReachedError extends Error {
  constructor() {
    super(
      "This GitLaunch instance is licensed for a single account. Ask the owner to invite you.",
    );
    this.name = "AccountLimitReachedError";
  }
}

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
    maxAccounts,
  } = params;

  const memberships = await membershipRepository.findByUserId(userId);
  if (memberships.length > 0) {
    const account = await accountRepository.findById(memberships[0].accountId);
    return { accountId: memberships[0].accountId, account, isNewUser: false };
  }

  // Checked only on the creation path, after existing members have returned
  // above: reaching the cap must never lock out the people already on the
  // instance, only stop a new workspace being carved out beside theirs.
  if (maxAccounts !== undefined) {
    const existing = await accountRepository.countAll();
    if (existing >= maxAccounts) {
      throw new AccountLimitReachedError();
    }
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
