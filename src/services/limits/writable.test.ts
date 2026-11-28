import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { AccountReadOnly, assertAccountWritable } from "./writable";
import { AccountState } from "./accountPolicy";

const limits = (state: Partial<AccountState> | Error) => ({
  getAccountState: async () => {
    if (state instanceof Error) throw state;
    return state as AccountState;
  },
});

describe("assertAccountWritable", () => {
  it("should let a change through for an account in good standing", async () => {
    await expect(
      assertAccountWritable(limits({ isReadOnly: false }), new ObjectId()),
    ).resolves.toBeUndefined();
  });

  it("should refuse a change for an account that has been made read-only", async () => {
    const attempt = assertAccountWritable(
      limits({ isReadOnly: true }),
      new ObjectId(),
    );

    await expect(attempt).rejects.toThrow(AccountReadOnly);
    await expect(attempt).rejects.toThrow(
      "Account is read-only. Please update your plan or payment method.",
    );
  });

  it("should not block a change because the account's standing could not be looked up", async () => {
    // What is wrong with the account, if anything, is for the change itself
    // to report: a missing account fails there with its own message.
    await expect(
      assertAccountWritable(
        limits(new Error("Account not found")),
        new ObjectId(),
      ),
    ).resolves.toBeUndefined();
  });
});
