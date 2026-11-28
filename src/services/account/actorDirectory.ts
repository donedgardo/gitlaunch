import { ObjectId } from "mongodb";
import { UserActor } from "../service/actor";

// The little this needs to know about a person. UserRepository satisfies it;
// so does a plain object in a test.
export type UserLookup = {
  findById(id: ObjectId): Promise<{
    name: string | null;
    githubLogin?: string;
    email: string | null;
  } | null>;
};

const UNKNOWN_PERSON = "A teammate";

/**
 * Turns the user id a session carries into the actor recorded on a change.
 *
 * A session knows who is signed in only by id; history needs a name a
 * teammate will recognise. The whole email address is never used as one — the
 * name is copied onto every change the person makes and shown to the team.
 */
export class ActorDirectory {
  constructor(private readonly users: UserLookup) {}

  async forUser(userId: ObjectId | string): Promise<UserActor> {
    const id = typeof userId === "string" ? new ObjectId(userId) : userId;
    const user = await this.users.findById(id);
    const name =
      user?.name?.trim() ||
      user?.githubLogin ||
      user?.email?.split("@")[0] ||
      UNKNOWN_PERSON;
    return { kind: "user", userId: id, name, via: "dashboard" };
  }
}
