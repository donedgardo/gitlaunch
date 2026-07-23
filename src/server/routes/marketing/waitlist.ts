import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { WaitlistService } from "../../../services/marketing/waitlistService";
import { LeadAttribution } from "../../../repositories/leadRepository";
import {
  WaitlistExperiment,
  WAITLIST_VISITOR_COOKIE,
} from "../../../services/marketing/waitlistExperiment";

export type WaitlistRoutesDeps = {
  waitlistService: WaitlistService;
  // Optional: attributes the signup to the visitor's landing-page A/B variant.
  experiment?: WaitlistExperiment;
};

type WaitlistBody = {
  email?: string;
  // Honeypot: named to look worth filling to a bot, hidden from humans.
  company_website?: string;
  elapsedMs?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  referrer?: string;
};

// Trim, drop empties, and cap length so attribution fields can't be abused as
// a storage sink.
function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, 200);
  return trimmed === "" ? undefined : trimmed;
}

function buildAttribution(body: WaitlistBody): LeadAttribution {
  const attribution: LeadAttribution = {};
  const source = clean(body.utm_source);
  const medium = clean(body.utm_medium);
  const campaign = clean(body.utm_campaign);
  const term = clean(body.utm_term);
  const content = clean(body.utm_content);
  const referrer = clean(body.referrer);
  if (source) attribution.source = source;
  if (medium) attribution.medium = medium;
  if (campaign) attribution.campaign = campaign;
  if (term) attribution.term = term;
  if (content) attribution.content = content;
  if (referrer) attribution.referrer = referrer;
  return attribution;
}

export function registerWaitlistRoutes(
  app: FastifyInstance,
  deps: WaitlistRoutesDeps,
): void {
  const { waitlistService, experiment } = deps;

  app.post<{ Body: WaitlistBody }>(
    "/waitlist",
    async (
      request: FastifyRequest<{ Body: WaitlistBody }>,
      reply: FastifyReply,
    ) => {
      const body = request.body ?? {};
      const visitorId =
        (request.cookies && request.cookies[WAITLIST_VISITOR_COOKIE]) || "";

      const elapsedRaw = body.elapsedMs;
      const elapsedNum =
        elapsedRaw !== undefined && elapsedRaw !== ""
          ? Number(elapsedRaw)
          : NaN;
      const elapsedMs = Number.isFinite(elapsedNum) ? elapsedNum : undefined;

      const outcome = await waitlistService.submit({
        email: (body.email ?? "").toString(),
        honeypot: body.company_website,
        elapsedMs,
        attribution: buildAttribution(body),
      });

      // Attribute a genuinely new signup to the visitor's landing A/B variant.
      // Re-evaluated server-side from the cookie so it can't be spoofed by the
      // form, and skipped for bots / idempotent resubmits (no conversion there).
      if (
        experiment &&
        visitorId &&
        outcome.status === "subscribed" &&
        !outcome.alreadyOnList
      ) {
        const resolved = await experiment.resolve(visitorId);
        void experiment.recordConversion(visitorId, resolved.variant);
      }

      // A malformed email is the only failure we tell the visitor about — real
      // people mistype. Bot rejections (honeypot / too-fast) render the same
      // success view so automated fillers get no signal they were caught.
      if (outcome.status === "rejected" && outcome.reason === "invalid_email") {
        return reply.view(
          "partials/waitlistResult",
          { error: true },
          { layout: "" },
        );
      }

      return reply.view(
        "partials/waitlistResult",
        {
          success: true,
          alreadyOnList:
            outcome.status === "subscribed" && outcome.alreadyOnList,
        },
        { layout: "" },
      );
    },
  );
}
