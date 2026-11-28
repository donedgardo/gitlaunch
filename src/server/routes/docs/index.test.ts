import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import fastifyView from "@fastify/view";
import * as handlebars from "handlebars";
import path from "node:path";
import { registerDocsRoutes } from "./index";
import { gitlaunchTools } from "../../../services/mcp/gitlaunchTools";
import { emptyToolDeps } from "../../../services/mcp/fakes";

// Shared on a developer Discord, the landing page was read as an email
// harvester: an email form and no way to see how the product actually works.
// This page is the answer — the whole integration contract, readable by anyone
// with no account, no session and no email address.
describe("public docs, rendered", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(fastifyView, {
      engine: { handlebars },
      root: path.join(__dirname, "../../../templates"),
      options: {
        compileOptions: { preventIndent: true },
        partials: { legalStyles: "/partials/legalStyles.hbs" },
      },
    });
    registerDocsRoutes(app, {
      publicUrl: "https://gitlaunch.example",
      mcpTools: gitlaunchTools(emptyToolDeps()).describeAll(),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should serve the docs to anyone, with no session", async () => {
    const response = await app.inject({ method: "GET", url: "/docs" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("<h1>How GitLaunch works</h1>");
  });

  it("should show the full build-report and deploy contract, not a teaser", async () => {
    const response = await app.inject({ method: "GET", url: "/docs" });

    // The two directions of the loop, as real HTTP a reader could run today,
    // addressed to this instance rather than to the hosted one.
    expect(response.body).toContain(
      "https://gitlaunch.example/api/v1/services/",
    );
    expect(response.body).toContain("POST");
    expect(response.body).toContain("/builds");
    expect(response.body).toContain("PATCH");
    expect(response.body).toContain("/deploy/");
    for (const status of ["deploying", "deployed", "error", "cancelled"]) {
      expect(response.body).toContain(status);
    }
  });

  it("should name every CI system the snippets cover, so it reads as on-top-of CI rather than instead-of", async () => {
    const response = await app.inject({ method: "GET", url: "/docs" });

    for (const ci of ["GitHub Actions", "GitLab CI", "Jenkins", "CircleCI"]) {
      expect(response.body).toContain(ci);
    }
    expect(response.body).toMatch(/not (another|a) CI/i);
  });

  it("should show how to connect an agent to the MCP server on this instance", async () => {
    const response = await app.inject({ method: "GET", url: "/docs" });

    // The endpoint and a command a reader can paste, addressed to this
    // instance rather than to the hosted one.
    expect(response.body).toContain('id="mcp"');
    expect(response.body).toContain("https://gitlaunch.example/mcp");
    expect(response.body).toContain("claude mcp add --transport http");
    expect(response.body).toContain("Authorization: Bearer");
  });

  it("should list every MCP tool and say which ones change things", async () => {
    const response = await app.inject({ method: "GET", url: "/docs" });

    for (const tool of [
      "list_services",
      "get_release_board",
      "wait_for_deploy",
      "get_build",
      "get_activity",
      "get_delivery_metrics",
      "list_flags",
      "get_flag",
      "deploy_build",
      "rollback_environment",
      "set_flag_environment",
    ]) {
      expect(response.body).toContain(tool);
    }
    expect(response.body).toContain("deployments:write");
    expect(response.body).toContain("flags:write");
    // Each row says what the tool does in a clause, not the paragraph written
    // for the model.
    expect(response.body).toContain(
      "<td>Undo the latest release to an environment. <strong>Changes things.</strong></td>",
    );
    expect(response.body).toContain(
      "<td>See what is deployed where for one service.</td>",
    );
  });

  it("should point at the source and at self-hosting", async () => {
    const response = await app.inject({ method: "GET", url: "/docs" });

    // Open core is the strongest answer to "what happens to my email" — the
    // reader can run it themselves without giving us anything.
    expect(response.body).toContain("https://github.com/donedgardo/gitlaunch");
    expect(response.body).toMatch(/self-host/i);
  });

  it("should link to the agent skill it serves", async () => {
    const response = await app.inject({ method: "GET", url: "/docs" });

    expect(response.body).toContain("/skills/gitlaunch-onboarding/SKILL.md");
  });

  it("should let every inline URL wrap so a phone viewport keeps its margins", async () => {
    // A `<code>` holding a full endpoint URL cannot break at spaces; on a
    // 390px phone it pushed the document to ~495px, the browser zoomed out
    // to fit, and the page rendered with no side margins at all.
    const response = await app.inject({ method: "GET", url: "/docs" });

    expect(response.body).toContain("overflow-wrap: anywhere");
  });

  it("should tell a reader how to get an account, not ask them to wait for one", async () => {
    // Signup is open. A page that still talks about a beta and a waitlist
    // sends a reader away from a product they could be using.
    const response = await app.inject({ method: "GET", url: "/docs" });

    expect(response.body).toContain('id="start"');
    expect(response.body).toContain('href="/signup"');
    expect(response.body.toLowerCase()).not.toContain("waitlist");
    expect(response.body.toLowerCase()).not.toContain("in beta");
  });

  it("should be indexable and leave no unresolved placeholders", async () => {
    const response = await app.inject({ method: "GET", url: "/docs" });

    expect(response.body).toContain(
      '<meta name="robots" content="index, follow" />',
    );
    expect(response.body).toContain(
      '<link rel="canonical" href="https://gitlaunch.example/docs" />',
    );
    expect(response.body).not.toContain("{{");
  });
});
