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

export function registerPlugins(server: FastifyInstance) {
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
        githubSecretsSetup: "/partials/githubSecretsSetup.hbs",
        jenkinsBuildReportingGuide: "/partials/jenkinsBuildReportingGuide.hbs",
        jenkinsDeploymentGuide: "/partials/jenkinsDeploymentGuide.hbs",
        htmxDashboard: "/partials/htmxDashboard.hbs",
        paginationControls: "/partials/paginationControls.hbs",
        setupStep: "/partials/setupStep.hbs",
      },
    },
  });
  server.register(fastifyStatic, {
    root: path.join(__dirname, "../public"),
    prefix: "/public",
    list: true,
  });
  server.register(fastifyCookie, {
    secret: process.env.COOKIE_SECRET_SIGNATURE,
    hook: "preParsing",
    parseOptions: {},
  });

  server.register(FastifySSEPlugin);
}
