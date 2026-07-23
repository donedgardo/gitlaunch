import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import { AccountRepository } from "../../repositories/accountRepository";
import { ServiceRepository } from "../../repositories/serviceRepository";
import {
  AnalyticsQueryService,
  Interval,
} from "../../services/analytics/analyticsQueryService";

export type AnalyticsRoutesDeps = {
  analyticsQueryService: AnalyticsQueryService;
  accountRepository: AccountRepository;
  serviceRepository: ServiceRepository;
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const DAY_MS = 24 * 60 * 60 * 1000;

type AnalyticsQuery = {
  from?: string;
  to?: string;
  interval?: string;
  event?: string;
  property?: string;
};

// yyyy-mm-dd for <input type="date">
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function labelForBucket(bucket: Date, interval: Interval): string {
  const base = `${MONTHS[bucket.getUTCMonth()]} ${bucket.getUTCDate()}`;
  if (interval === "hour") {
    return `${base} ${String(bucket.getUTCHours()).padStart(2, "0")}:00`;
  }
  return base;
}

function withBarPct<T extends { count: number }>(
  rows: T[],
): (T & {
  barPct: number;
})[] {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return rows.map((r) => ({ ...r, barPct: Math.round((r.count / max) * 100) }));
}

export default function (deps: AnalyticsRoutesDeps) {
  const { analyticsQueryService, accountRepository, serviceRepository } = deps;

  return function (server: FastifyInstance, _opts: any, done: any) {
    server.addHook("preHandler", async (req, res) => {
      if (!req.session && !req.user) {
        return res.redirect("/");
      }
      if (req.session) {
        const account = await accountRepository.findById(
          new ObjectId(req.session.accountId),
        );
        if (!account) {
          res.clearCookie("session", { path: "/" });
          return res.redirect("/");
        }
      }
    });

    async function buildViewModel(accountId: ObjectId, query: AnalyticsQuery) {
      const interval: Interval = query.interval === "hour" ? "hour" : "day";
      const property = query.property?.trim() || "environment";
      const event = query.event?.trim() || undefined;

      // Default window: the last 14 days (inclusive of today).
      const now = new Date();
      const toExclusive = query.to
        ? new Date(new Date(`${query.to}T00:00:00Z`).getTime() + DAY_MS)
        : new Date(
            Date.UTC(
              now.getUTCFullYear(),
              now.getUTCMonth(),
              now.getUTCDate(),
            ) + DAY_MS,
          );
      const from = query.from
        ? new Date(`${query.from}T00:00:00Z`)
        : new Date(toExclusive.getTime() - 14 * DAY_MS);

      const range = { accountId, from, to: toExclusive };

      const [volume, uniqueUsers, topEventsRaw, breakdownRaw] =
        await Promise.all([
          analyticsQueryService.eventVolume({ ...range, event, interval }),
          analyticsQueryService.uniqueUsers({ ...range, event }),
          analyticsQueryService.topEvents({ ...range, limit: 50 }),
          analyticsQueryService.breakdownBy({ ...range, property, event }),
        ]);

      const totalEvents = volume.reduce((sum, p) => sum + p.count, 0);

      return {
        // Controls (echoed back so the form keeps its state)
        fromValue: isoDate(from),
        toValue: isoDate(new Date(toExclusive.getTime() - DAY_MS)),
        interval,
        property,
        selectedEvent: event ?? "",
        eventOptions: topEventsRaw.map((e) => e.event),

        // KPIs
        totalEvents,
        uniqueUsers,

        // Charts
        hasVolume: volume.length > 0,
        volume: withBarPct(
          volume.map((p) => ({
            label: labelForBucket(p.bucket, interval),
            count: p.count,
          })),
        ),
        topEvents: withBarPct(topEventsRaw.slice(0, 10)),
        hasBreakdown: breakdownRaw.length > 0,
        breakdown: withBarPct(breakdownRaw),
      };
    }

    // GET /dashboard/analytics — full page
    server.get(
      "/dashboard/analytics",
      async (req: FastifyRequest<{ Querystring: AnalyticsQuery }>, res) => {
        const accountId = new ObjectId(req.session!.accountId);
        const services = await serviceRepository.findByAccountId(accountId);
        const model = await buildViewModel(accountId, req.query);

        return res.view(
          "analytics",
          {
            title: "Analytics",
            services: services.map((s) => s.name),
            activeService: null,
            ...model,
          },
          { layout: "/layouts/main.hbs" },
        );
      },
    );

    // GET /dashboard/analytics/data — HTMX partial (charts only)
    server.get(
      "/dashboard/analytics/data",
      async (
        req: FastifyRequest<{ Querystring: AnalyticsQuery }>,
        res: FastifyReply,
      ) => {
        const accountId = new ObjectId(req.session!.accountId);
        const model = await buildViewModel(accountId, req.query);
        return res.view("partials/analyticsPanel", model);
      },
    );

    done();
  };
}
