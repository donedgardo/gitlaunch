/**
 * Internal product & marketing analytics reporter.
 *
 * Reads the analytics warehouse (`analytics_events`) and prints a briefing:
 * campaign attribution, A/B experiment verdicts, and product usage.
 *
 * Usage:
 *   yarn analytics                         # last 30 days, markdown
 *   yarn analytics --days 7
 *   yarn analytics --from 2026-07-01 --to 2026-07-25
 *   yarn analytics --json                  # machine-readable
 *   yarn analytics --account <objectId>    # scope usage to one tenant
 *   yarn analytics --interval week
 *   yarn analytics --funnel a,b,c          # override the activation funnel
 *
 * Connection: --uri, else MONGODB_URI, else localhost. Read-only — this script
 * never writes to the database.
 */
import { MongoClient, ObjectId } from "mongodb";
import {
  InsightsService,
  DEFAULT_FUNNEL,
} from "../src/services/analytics/insightsService";
import { renderInsightsReport } from "../src/services/analytics/insightsReport";
import { UsageInterval } from "../src/services/analytics/productUsageService";

type Options = {
  uri: string;
  dbName: string;
  from: Date;
  to: Date;
  accountId?: ObjectId;
  interval: UsageInterval;
  funnelSteps: string[];
  json: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function parseArgs(argv: string[]): Options {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags.set(name, next);
      i++;
    } else {
      flags.set(name, "true");
    }
  }

  const to = flags.has("to") ? new Date(flags.get("to")!) : new Date();
  const days = parseInt(flags.get("days") ?? "30", 10);
  const from = flags.has("from")
    ? new Date(flags.get("from")!)
    : new Date(to.getTime() - days * DAY_MS);

  for (const [label, date] of [
    ["--from", from],
    ["--to", to],
  ] as const) {
    if (Number.isNaN(date.getTime())) {
      throw new Error(`${label} is not a valid date`);
    }
  }

  const accountId = flags.get("account");
  if (accountId && !ObjectId.isValid(accountId)) {
    throw new Error(`--account must be a valid ObjectId, got "${accountId}"`);
  }

  const interval = (flags.get("interval") ?? "day") as UsageInterval;
  if (interval !== "day" && interval !== "week") {
    throw new Error(`--interval must be "day" or "week", got "${interval}"`);
  }

  const uri =
    flags.get("uri") ?? process.env.MONGODB_URI ?? "mongodb://localhost:27017";

  return {
    uri,
    // A URI may already name a database; --db wins, then the URI's own path.
    dbName: flags.get("db") ?? databaseFromUri(uri) ?? "gitlaunch",
    from,
    to,
    accountId: accountId ? new ObjectId(accountId) : undefined,
    interval,
    funnelSteps:
      flags
        .get("funnel")
        ?.split(",")
        .map((s) => s.trim())
        .filter(Boolean) ?? DEFAULT_FUNNEL,
    json: flags.get("json") === "true",
  };
}

function databaseFromUri(uri: string): string | undefined {
  const path = uri.split("/")[3]?.split("?")[0];
  return path && path.length > 0 ? path : undefined;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const client = new MongoClient(options.uri, {
    serverSelectionTimeoutMS: 15000,
  });

  try {
    await client.connect();
    const insights = new InsightsService(client.db(options.dbName));
    const report = await insights.build({
      from: options.from,
      to: options.to,
      accountId: options.accountId,
      interval: options.interval,
      funnelSteps: options.funnelSteps,
    });

    console.log(
      options.json
        ? JSON.stringify(report, null, 2)
        : renderInsightsReport(report),
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(`analytics-report failed: ${error.message}`);
  process.exit(1);
});
