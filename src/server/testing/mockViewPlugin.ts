import { FastifyInstance, FastifyReply } from "fastify";
import fp from "fastify-plugin";

type ViewData = Record<string, unknown>;
type ViewOptions = { layout?: string };

/**
 * Mock view plugin for unit tests.
 *
 * This plugin provides a mock implementation of reply.view() that returns
 * JSON with the template name and data, allowing tests to verify view calls
 * without needing the full Handlebars setup.
 *
 * Usage in tests:
 * ```ts
 * import { mockViewPlugin } from "../../testing/mockViewPlugin";
 * app.register(mockViewPlugin);
 * ```
 */
async function mockViewPluginFn(fastify: FastifyInstance) {
  fastify.decorateReply(
    "view",
    function (
      this: FastifyReply,
      template: string,
      data?: ViewData,
      _options?: ViewOptions,
    ) {
      // Return HTML that includes the data for test assertions
      // This mimics what the real view engine would do
      const html = `
      <!DOCTYPE html>
      <html>
      <head><title>${data?.title || "Test"}</title></head>
      <body data-template="${template}">
        ${template === "onboarding/plan-selection" ? `<h1>Choose your plan</h1>` : ""}
        ${data?.apiKey ? `<h1>Your API Key</h1><code id="api-key">${data.apiKey}</code>` : ""}
        ${data?.error ? `<div id="plan-error">${data.error}</div>` : ""}
        ${data?.maxRepositories ? `<span id="max-repos">${data.maxRepositories}</span>` : ""}
        ${data?.plan ? `<span id="plan">${data.plan}</span>` : ""}
        ${data?.privateReposAllowed === false ? `<span id="public-only-notice">Public repos only</span>` : ""}
        ${
          Array.isArray(data?.repositories)
            ? data.repositories
                .map(
                  (repo: { id: number; full_name: string; private: boolean }) =>
                    `<label><input type="checkbox" name="repositories" value="${repo.id}"/>${repo.full_name}${repo.private ? "<span>Private</span>" : ""}</label>`,
                )
                .join("")
            : ""
        }
      </body>
      </html>
    `;
      return this.header("Content-Type", "text/html").send(html);
    },
  );
}

export const mockViewPlugin = fp(mockViewPluginFn, {
  name: "mock-view-plugin",
});
