/**
 * Which warehouse traffic is our own.
 *
 * The team tests its own landing page and uses its own product, and those
 * events land in the same collection as real ones. Left in, they read as
 * acquisition: two of the first three waitlist signups were the founder's own
 * form submissions, which is enough to move a conversion rate on low volume.
 *
 * Two rules, because internal traffic arrives under two different identities:
 *
 * - `ANALYTICS_INTERNAL_EMAILS` — addresses (`me@x.dev`) or whole domains
 *   (`@x.dev`). Applied at capture: a matching signup is still stored as a
 *   lead, but its event is stamped `internal: true` so reporting can drop it.
 * - `ANALYTICS_INTERNAL_ACTORS` — literal `distinctId`s (a `gl_vid` visitor
 *   cookie, a user ObjectId). Applied at query time, which is what makes it
 *   retroactive: existing rows can be excluded without rewriting them.
 *
 * Unconfigured means nothing is internal. Reporting that silently hides rows
 * by default would be worse than reporting that counts a few of our own.
 */

// Indexed rather than a closed shape so `process.env` satisfies it directly.
export type InternalTrafficEnv = Record<string, string | undefined> & {
  ANALYTICS_INTERNAL_EMAILS?: string;
  ANALYTICS_INTERNAL_ACTORS?: string;
};

// Property stamped on events the capture path recognised as internal.
export const INTERNAL_PROPERTY = "properties.internal";

function splitList(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

export class InternalTraffic {
  private constructor(
    private readonly emails: Set<string>,
    private readonly domains: string[],
    private readonly actors: string[],
  ) {}

  static fromEnv(env: InternalTrafficEnv = process.env): InternalTraffic {
    const entries = splitList(env.ANALYTICS_INTERNAL_EMAILS);
    // A leading "@" marks a whole-domain rule; anything else is one address.
    const domains = entries
      .filter((entry) => entry.startsWith("@"))
      .map((entry) => entry.slice(1));
    const emails = entries.filter((entry) => !entry.startsWith("@"));
    return new InternalTraffic(
      new Set(emails),
      domains,
      splitList(env.ANALYTICS_INTERNAL_ACTORS),
    );
  }

  /** No rules configured — every helper below is a no-op. */
  get configured(): boolean {
    return (
      this.emails.size > 0 || this.domains.length > 0 || this.actors.length > 0
    );
  }

  isInternalEmail(email: string | null | undefined): boolean {
    if (!email) return false;
    const normalized = email.trim().toLowerCase();
    if (this.emails.has(normalized)) return true;
    // Match on the domain part only, so "@example.com" never matches
    // "someone@notexample.com".
    const at = normalized.lastIndexOf("@");
    if (at < 0) return false;
    const domain = normalized.slice(at + 1);
    return this.domains.includes(domain);
  }

  isInternalActor(distinctId: string | null | undefined): boolean {
    if (!distinctId) return false;
    return this.actors.includes(distinctId.trim().toLowerCase());
  }

  /**
   * Mongo `$match` fragment dropping internal events. Returns `{}` when
   * unconfigured so callers can spread it unconditionally.
   *
   * Wrapped in `$and` so spreading it alongside other conditions can never
   * collide with an existing `distinctId` or `properties.*` key.
   */
  excludeMatch(): Record<string, unknown> {
    if (!this.configured) return {};
    const clauses: Record<string, unknown>[] = [
      { [INTERNAL_PROPERTY]: { $ne: true } },
    ];
    if (this.actors.length > 0) {
      clauses.push({ distinctId: { $nin: this.actors } });
    }
    return { $and: clauses };
  }
}
