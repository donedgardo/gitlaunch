import { describe, it, expect } from "vitest";
import { PasswordService } from "./passwordService";

describe("PasswordService", () => {
  // Low cost factor keeps the test fast; behavior is identical.
  const service = new PasswordService(4);

  it("should verify a password against its own hash", async () => {
    const hash = await service.hash("correct horse battery staple");
    expect(await service.verify("correct horse battery staple", hash)).toBe(
      true,
    );
  });

  it("should reject an incorrect password", async () => {
    const hash = await service.hash("the-right-password");
    expect(await service.verify("the-wrong-password", hash)).toBe(false);
  });

  it("should not store the plaintext in the hash", async () => {
    const hash = await service.hash("supersecret");
    expect(hash).not.toContain("supersecret");
  });
});
