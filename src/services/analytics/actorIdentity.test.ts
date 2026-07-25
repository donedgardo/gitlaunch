import { describe, it, expect } from "vitest";
import { classifyActor, machineActor } from "./actorIdentity";

describe("actorIdentity", () => {
  describe("machineActor", () => {
    it("should label an API key as a machine actor", () => {
      // Given an API key doing the work
      // When I build its actor id
      const actor = machineActor("6a5ee3d78892169df80ea18e");

      // Then it is distinguishable from a human's id
      expect(actor).toBe("apikey:6a5ee3d78892169df80ea18e");
      expect(classifyActor(actor)).toBe("machine");
    });
  });

  describe("classifyActor", () => {
    it("should recognise a logged-in user by their id", () => {
      // Given a user id as stored on user_logged_in events
      // When I classify it
      // Then it is a person using the product
      expect(classifyActor("6a5ee3c88892169df80ea18a")).toBe("user");
    });

    it("should recognise an anonymous landing visitor by their cookie", () => {
      // Given a gl_vid visitor cookie
      // When I classify it
      // Then it is an anonymous visitor, not a product user
      expect(classifyActor("6953af16-c997-4c9e-ad84-0c21ce8d5cef")).toBe(
        "visitor",
      );
    });

    it("should not mistake anything else for a product user", () => {
      // Given ids that are neither users, machines nor visitors
      // When I classify them
      // Then they are reported as unknown rather than counted as people
      expect(classifyActor("someone@example.com")).toBe("unknown");
      expect(classifyActor("github:12345")).toBe("unknown");
    });

    it("should treat a missing actor as unknown", () => {
      // Given an event that recorded nobody
      // When I classify it
      // Then nothing is claimed about who did it
      expect(classifyActor(undefined)).toBe("unknown");
      expect(classifyActor(null)).toBe("unknown");
      expect(classifyActor("")).toBe("unknown");
    });
  });
});
