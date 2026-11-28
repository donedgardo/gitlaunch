import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { ActorDirectory, UserLookup } from "./actorDirectory";

type Person = Awaited<ReturnType<UserLookup["findById"]>>;

const directoryOf = (person: Person) =>
  new ActorDirectory({ findById: async () => person });

describe("ActorDirectory", () => {
  describe("forUser", () => {
    const userId = new ObjectId();

    it("should name a person by their name", async () => {
      const actor = await directoryOf({
        name: "Maria Lopez",
        githubLogin: "qa-maria",
        email: "maria@example.com",
      }).forUser(userId);

      expect(actor).toEqual({
        kind: "user",
        userId,
        name: "Maria Lopez",
        via: "dashboard",
      });
    });

    it("should fall back to their GitHub login when they have no name", async () => {
      const actor = await directoryOf({
        name: null,
        githubLogin: "qa-maria",
        email: "maria@example.com",
      }).forUser(userId);

      expect(actor.name).toBe("qa-maria");
    });

    it("should fall back to the part of their email before the @, never the whole address", async () => {
      const actor = await directoryOf({
        name: null,
        email: "maria@example.com",
      }).forUser(userId);

      expect(actor.name).toBe("maria");
    });

    it("should still attribute the action when the person cannot be found", async () => {
      const actor = await directoryOf(null).forUser(userId);

      expect(actor.userId).toEqual(userId);
      expect(actor.name).toBe("A teammate");
    });

    it("should accept the id as the string a session carries", async () => {
      const actor = await directoryOf({ name: "Maria", email: null }).forUser(
        userId.toString(),
      );

      expect(actor.userId).toEqual(userId);
    });
  });
});
