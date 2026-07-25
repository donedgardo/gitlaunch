/**
 * Reconciles the `leads` collection with the signup events in the analytics
 * warehouse.
 *
 * Early leads were captured before the warehouse recorded signups, and some
 * early signup events were written without a tenant or an actor — both make
 * campaign attribution undercount. This makes the two agree.
 *
 * Usage:
 *   yarn analytics:backfill                  # dry run — prints what it would do
 *   yarn analytics:backfill --apply          # actually writes
 *   yarn analytics:backfill --account <id>   # pick the tenant explicitly
 *
 * Connection: --uri, else MONGODB_URI, else localhost. Safe to re-run: events
 * are matched by their `leadId` stamp, so a second run is a no-op.
 */
import { MongoClient, ObjectId } from "mongodb";
import { SIGNUP_EVENT } from "../src/services/analytics/campaignAnalyticsService";
import {
  LeadRecord,
  planSignupBackfill,
  SignupEventRecord,
} from "../src/services/analytics/signupBackfill";

function flagsFrom(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags.set(argv[i].slice(2), next);
      i++;
    } else {
      flags.set(argv[i].slice(2), "true");
    }
  }
  return flags;
}

function databaseFromUri(uri: string): string | undefined {
  const path = uri.split("/")[3]?.split("?")[0];
  return path && path.length > 0 ? path : undefined;
}

async function main() {
  const flags = flagsFrom(process.argv.slice(2));
  const apply = flags.get("apply") === "true";
  const uri =
    flags.get("uri") ?? process.env.MONGODB_URI ?? "mongodb://localhost:27017";
  const dbName = flags.get("db") ?? databaseFromUri(uri) ?? "gitlaunch";

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });

  try {
    await client.connect();
    const db = client.db(dbName);

    const accountId = await resolveAccount(db, flags.get("account"));

    const leads = (await db
      .collection("leads")
      .find({})
      .toArray()) as unknown as LeadRecord[];
    const events = (await db
      .collection("analytics_events")
      .find({ event: SIGNUP_EVENT })
      .toArray()) as unknown as SignupEventRecord[];

    const plan = planSignupBackfill({ leads, events, accountId });

    console.log(`Database:       ${dbName}`);
    console.log(`Account:        ${accountId.toString()}`);
    console.log(`Leads:          ${leads.length}`);
    console.log(`Signup events:  ${events.length}`);
    console.log(`Already correct: ${plan.alreadyCorrect}`);
    console.log(`To create:      ${plan.inserts.length}`);
    console.log(`To update:      ${plan.updates.length}`);
    console.log("");

    for (const insert of plan.inserts) {
      console.log(
        `  + create ${SIGNUP_EVENT} @ ${insert.timestamp.toISOString()} lead=${insert.properties.leadId} campaign=${insert.properties.campaign ?? "(direct)"}`,
      );
    }
    for (const update of plan.updates) {
      console.log(
        `  ~ update ${update._id.toString()} set ${Object.keys(update.set).join(", ")}`,
      );
    }

    if (plan.inserts.length === 0 && plan.updates.length === 0) {
      console.log("Nothing to do — leads and the warehouse already agree.");
      return;
    }

    if (!apply) {
      console.log("");
      console.log("Dry run. Re-run with --apply to write these changes.");
      return;
    }

    const collection = db.collection("analytics_events");
    if (plan.inserts.length > 0) {
      await collection.insertMany(plan.inserts as any[]);
    }
    for (const update of plan.updates) {
      await collection.updateOne({ _id: update._id }, { $set: update.set });
    }
    console.log("");
    console.log(
      `Applied: ${plan.inserts.length} created, ${plan.updates.length} updated.`,
    );
  } finally {
    await client.close();
  }
}

/**
 * The tenant these signups belong to. Explicit wins; otherwise this only
 * guesses when the choice is unambiguous, so a multi-tenant database can never
 * have signups silently filed under the wrong account.
 */
async function resolveAccount(
  db: ReturnType<MongoClient["db"]>,
  requested?: string,
): Promise<ObjectId> {
  if (requested) {
    if (!ObjectId.isValid(requested)) {
      throw new Error(`--account must be a valid ObjectId, got "${requested}"`);
    }
    return new ObjectId(requested);
  }

  const accounts = await db.collection("accounts").find({}).limit(2).toArray();
  if (accounts.length === 1) return accounts[0]._id;

  throw new Error(
    accounts.length === 0
      ? "No accounts found — pass --account <objectId>."
      : "More than one account exists — pass --account <objectId> to say which one owns these signups.",
  );
}

main().catch((error) => {
  console.error(`backfill-analytics failed: ${error.message}`);
  process.exit(1);
});
