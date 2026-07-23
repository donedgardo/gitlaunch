import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import {
  WaitlistExperiment,
  WAITLIST_VISITOR_COOKIE,
} from "../../services/marketing/waitlistExperiment";

export type HomeRouteDeps = {
  experiment?: WaitlistExperiment;
};

// A year — long enough that a returning visitor keeps the same A/B arm.
const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export default function (deps: HomeRouteDeps = {}) {
  const { experiment } = deps;

  return function (server: FastifyInstance, opts: any, done: any) {
    server.get("/", async (req, res) => {
      // If user is logged in (has session), redirect to dashboard
      if (req.session) {
        return res.redirect("/dashboard");
      }

      // Anonymous marketing traffic: assign a stable visitor id so the waitlist
      // A/B test buckets the same person consistently across the visit.
      let visitorId =
        (req.cookies && req.cookies[WAITLIST_VISITOR_COOKIE]) || "";
      if (!visitorId) {
        visitorId = randomUUID();
        res.setCookie(WAITLIST_VISITOR_COOKIE, visitorId, {
          path: "/",
          httpOnly: true,
          sameSite: "lax",
          maxAge: VISITOR_COOKIE_MAX_AGE,
        });
      }

      // Resolve the landing-page copy variant through our own feature flag, then
      // record the exposure. Falls back to control copy when the flag is off.
      const resolved = experiment
        ? await experiment.resolve(visitorId)
        : undefined;
      if (experiment && resolved) {
        experiment.recordExposure(visitorId, resolved);
      }
      const copy = resolved ? resolved.copy : WaitlistExperiment.controlCopy();

      // Show landing page for non-logged in users
      return res.view(
        "index.hbs",
        { ...copy, variant: resolved?.variant ?? "control" },
        {
          layout: "/layouts/main.hbs",
        },
      );
    });
    done();
  };
}
