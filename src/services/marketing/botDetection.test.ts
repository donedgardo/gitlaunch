import { describe, it, expect } from "vitest";
import { evaluateSubmission } from "./botDetection";

describe("botDetection", () => {
  describe("evaluateSubmission", () => {
    const config = { minElapsedMs: 2000 };

    it("should accept a real person filling the form deliberately", () => {
      // Given: a valid email, empty honeypot, and enough time on the form
      const verdict = evaluateSubmission(
        { email: "maria@acme.dev", honeypot: "", elapsedMs: 8000 },
        config,
      );

      // Then: it is treated as a human
      expect(verdict).toEqual({ human: true });
    });

    it("should reject a submission that filled the honeypot field", () => {
      // Given: the hidden honeypot field is filled (only bots do this)
      const verdict = evaluateSubmission(
        {
          email: "maria@acme.dev",
          honeypot: "http://spam.example",
          elapsedMs: 8000,
        },
        config,
      );

      // Then: it is flagged as a bot with a honeypot reason
      expect(verdict).toEqual({ human: false, reason: "honeypot" });
    });

    it("should reject a submission that arrived faster than a human could type", () => {
      // Given: the form was submitted almost instantly
      const verdict = evaluateSubmission(
        { email: "maria@acme.dev", honeypot: "", elapsedMs: 300 },
        config,
      );

      // Then: it is flagged as too fast
      expect(verdict).toEqual({ human: false, reason: "too_fast" });
    });

    it("should reject a malformed email address", () => {
      // Given: an email that is not a real address
      const verdict = evaluateSubmission(
        { email: "not-an-email", honeypot: "", elapsedMs: 8000 },
        config,
      );

      // Then: it is rejected as an invalid email
      expect(verdict).toEqual({ human: false, reason: "invalid_email" });
    });

    it("should allow submissions when timing cannot be measured", () => {
      // Given: no elapsed time (e.g. client without JS timing)
      const verdict = evaluateSubmission(
        { email: "maria@acme.dev", honeypot: "" },
        config,
      );

      // Then: absence of timing does not block a real person
      expect(verdict).toEqual({ human: true });
    });

    it("should prioritize the honeypot signal over a bad email", () => {
      // Given: both the honeypot is filled and the email is invalid
      const verdict = evaluateSubmission(
        { email: "bad", honeypot: "x", elapsedMs: 8000 },
        config,
      );

      // Then: the strongest bot signal (honeypot) is reported
      expect(verdict).toEqual({ human: false, reason: "honeypot" });
    });
  });
});
