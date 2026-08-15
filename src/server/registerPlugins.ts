import { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyFormbody from "@fastify/formbody";
import { FastifySSEPlugin } from "fastify-sse-v2";
import fastifyView from "@fastify/view";
import fastifyCookie from "@fastify/cookie";
import rawBody from "fastify-raw-body";
import * as handlebars from "handlebars";
import path from "node:path";
import { registerHandlebarsHelpers } from "./registerHandlebarsHelpers";

// Type augmentation for fastify-raw-body
declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string | Buffer;
  }
}

export function registerPlugins(server: FastifyInstance, cookieSecret: string) {
  registerHandlebarsHelpers();
  server.register(fastifyFormbody);
  server.register(rawBody, {
    field: "rawBody",
    global: false,
    encoding: "utf8",
    runFirst: true,
  });
  server.register(fastifyView, {
    engine: {
      handlebars,
    },
    root: path.join(__dirname, "../templates"),
    options: {
      compileOptions: {
        preventIndent: true,
      },
      partials: {
        buildEnvironmentAction: "/partials/buildEnvironmentAction.hbs",
        buildReportingInstructions: "/partials/buildReportingInstructions.hbs",
        navigation: "/partials/navigation.hbs",
        buildRow: "/partials/buildRow.hbs",
        buildTable: "/partials/buildTable.hbs",
        emptyBuilds: "/partials/emptyBuilds.hbs",
        deploymentSetupGuide: "/partials/deploymentSetupGuide.hbs",
        environmentList: "/partials/environmentList.hbs",
        flagList: "/partials/flagList.hbs",
        flagKeyResult: "/partials/flagKeyResult.hbs",
        flagTargetingRule: "/partials/flagTargetingRule.hbs",
        flagConditionRow: "/partials/flagConditionRow.hbs",
        githubSecretsSetup: "/partials/githubSecretsSetup.hbs",
        jenkinsBuildReportingGuide: "/partials/jenkinsBuildReportingGuide.hbs",
        jenkinsDeploymentGuide: "/partials/jenkinsDeploymentGuide.hbs",
        rawBuildReportingGuide: "/partials/rawBuildReportingGuide.hbs",
        htmxDashboard: "/partials/htmxDashboard.hbs",
        paginationControls: "/partials/paginationControls.hbs",
        setupStep: "/partials/setupStep.hbs",
        waitlistResult: "/partials/waitlistResult.hbs",
        analyticsPanel: "/partials/analyticsPanel.hbs",
        doraPanel: "/partials/doraPanel.hbs",
        legalStyles: "/partials/legalStyles.hbs",
        aiAgentSetup: "/partials/aiAgentSetup.hbs",
      },
    },
  });
  server.register(fastifyStatic, {
    root: path.join(__dirname, "../public"),
    prefix: "/public",
    list: true,
  });
  // Agent Skills, served so a coding agent can read them straight off the
  // instance it is onboarding against — no install step, and a self-hosted
  // instance serves the skill matching its own version. Two levels up from
  // __dirname is the repo root in both src/ (dev) and dist/ (prod).
  server.register(fastifyStatic, {
    root: path.join(__dirname, "../../skills"),
    prefix: "/skills",
    list: true,
    decorateReply: false,
  });
  server.register(fastifyCookie, {
    secret: cookieSecret,
    hook: "preParsing",
    parseOptions: {},
  });

  server.register(FastifySSEPlugin);
}
