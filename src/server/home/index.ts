import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import {
  WaitlistExperiment,
  WAITLIST_VISITOR_COOKIE,
} from "../../services/marketing/waitlistExperiment";
import { buildPageMeta } from "../seo/meta";

// Just enough of SignupGate to ask "is the front door open?". The landing page
// has no business with the rest of the gate, and a narrow type keeps the test
// doubles honest.
export type SignupDoor = {
  allows(entityKey: string): Promise<{ allowed: boolean }>;
};

export type HomeRouteDeps = {
  experiment?: WaitlistExperiment;
  signupDoor?: SignupDoor;
};

// A year — long enough that a returning visitor keeps the same A/B arm.
const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export default function (deps: HomeRouteDeps = {}) {
  const { experiment, signupDoor } = deps;

  return function (server: FastifyInstance, opts: any, done: any) {
    server.get<{ Querystring: { error?: string } }>("/", async (req, res) => {
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
        void experiment.recordExposure(visitorId, resolved);
      }
      const copy = resolved ? resolved.copy : WaitlistExperiment.controlCopy();

      // Someone bounced off sign-in because self-serve signups are flagged off:
      // explain it here rather than leaving them on a silent redirect.
      const signupsClosed = req.query?.error === "signups_closed";

      // Whether the front door is open to new accounts, so the nav can say who
      // the login link is for instead of sending strangers into a redirect that
      // will only turn them away.
      //
      // This is a *hint*, not the decision: the real gate runs in the GitHub
      // callback keyed on `github:<id>`, while out here the visitor is anonymous
      // and all we have is their `gl_vid`. So a partial rollout can disagree with
      // what the gate would actually say, and allow-list rules on `githubLogin`
      // can never match this early. It only ever changes wording — the login link
      // itself always renders, because existing customers and invitees sign in
      // through it and the gate never blocks them.
      //
      // Deliberately no exposure event: this is a page render, not a signup
      // attempt, and counting it would drown the real decisions in the stream.
      const signupsOpen = signupDoor
        ? (await signupDoor.allows(visitorId)).allowed
        : true;

      // Sharing metadata for the one page that actually gets shared: the public
      // landing page. Kept stable and independent of the A/B copy arm so search
      // engines and link unfurlers see consistent content across visitors.
      const meta = buildPageMeta({
        title: "GitLaunch — Trigger deployments with confidence",
        description:
          "GitLaunch is a simple dashboard to trigger and track deployments across staging and production. Works with GitHub Actions, Jenkins, and more.",
        path: "/",
        publicUrl: process.env.PUBLIC_URL,
      });

      // Show landing page for non-logged in users
      return res.view(
        "index.hbs",
        {
          ...copy,
          variant: resolved?.variant ?? "control",
          signupsClosed,
          signupsOpen,
          meta,
        },
        {
          layout: "/layouts/main.hbs",
        },
      );
    });
    done();
  };
}
