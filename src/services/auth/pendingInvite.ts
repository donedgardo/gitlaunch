import { ObjectId } from "mongodb";

// Redeeming an invitation is a seat feature, but the login flow is the one place
// that has to offer it: someone who follows an invite link while logged out
// signs in first and joins second. Rather than let the open core reach into the
// invitation code for that one moment, it carries this hook and the enterprise
// wiring supplies it.
//
// Left unsupplied — which is what the open core does — a pending-invite cookie
// is simply never redeemed. That is the correct behaviour and not a degradation:
// with no invitation feature, nothing could have set the cookie.
export type PendingInviteRedeemer = (
  token: string,
  userId: ObjectId,
) => Promise<PendingInviteResult>;

export type PendingInviteResult = {
  joined: boolean;
  // The workspace they joined, so the session can be pointed at it instead of
  // the account that was just bootstrapped for them.
  accountId?: ObjectId;
};
