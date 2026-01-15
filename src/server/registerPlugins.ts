import { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyFormbody from "@fastify/formbody";
import { FastifySSEPlugin } from "fastify-sse-v2";
import fastifyView from "@fastify/view";
import fastifyCookie from "@fastify/cookie";
import oauthPlugin from "@fastify/oauth2";
import * as handlebars from "handlebars";
import path from "node:path";
import { redirect_uri } from "../services/auth/googleOAuthService";
import { registerHandlebarsHelpers } from "./registerHandlebarsHelpers";

export function registerPlugins(server: FastifyInstance) {
  registerHandlebarsHelpers();
  server.register(fastifyFormbody);
  server.register(fastifyView, {
    engine: {
      handlebars,
    },
    root: path.join(__dirname, "../templates"),
    options: {
      partials: {
        buildEnvironmentAction: "/partials/buildEnvironmentAction.hbs",
        navigation: "/partials/navigation.hbs",
        buildRow: "/partials/buildRow.hbs",
        buildTable: "/partials/buildTable.hbs",
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

  server.register(oauthPlugin, {
    name: "googleOAuth2",
    scope: ["profile", "email"],
    credentials: {
      client: {
        id: process.env.GOOGLE_CLIENT_ID as string,
        secret: process.env.GOOGLE_CLIENT_SECRET as string,
      },
      auth: oauthPlugin.GOOGLE_CONFIGURATION,
    },
    startRedirectPath: "/login/google",
    callbackUri: redirect_uri,
  });

  server.register(FastifySSEPlugin);
}
