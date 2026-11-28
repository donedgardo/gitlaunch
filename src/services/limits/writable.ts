import { ObjectId } from "mongodb";
import { AccountLimits } from "./accountPolicy";

/**
 * A change was refused because billing has put the account into read-only.
 * The message is written for the customer and is safe to show as it is.
 */
export class AccountReadOnly extends Error {
  constructor() {
    super("Account is read-only. Please update your plan or payment method.");
    this.name = "AccountReadOnly";
  }
}

/**
 * The one rule for "may this account change anything right now?", shared by
 * every way of making a change — REST and MCP alike.
 *
 * If the account's standing cannot be looked up, the change is let through:
 * whatever is wrong (usually that the account does not exist) is for the
 * change itself to report, with its own message.
 */
export async function assertAccountWritable(
  limits: Pick<AccountLimits, "getAccountState">,
  accountId: ObjectId,
): Promise<void> {
  let readOnly = false;
  try {
    readOnly = (await limits.getAccountState(accountId)).isReadOnly;
  } catch {
    return;
  }
  if (readOnly) throw new AccountReadOnly();
}
