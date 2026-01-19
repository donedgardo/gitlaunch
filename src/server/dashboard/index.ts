import * as Handlebars from "handlebars";
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import { ServiceRepository } from "../../repositories/serviceRepository";
import { BuildRepository, Build } from "../../repositories/buildRepository";

export type DashboardRoutesDeps = {
  serviceRepository: ServiceRepository;
  buildRepository: BuildRepository;
};

export default function (deps: DashboardRoutesDeps) {
  const { serviceRepository, buildRepository } = deps;

  return function (server: FastifyInstance, opts: any, done: any) {
    server.addHook("preHandler", (req, res, done) => {
      // Check for both new session (JWT) and legacy user auth
      if (!req.session && !req.user) {
        return res.redirect("/");
      }
      done();
    });

    // Helper to convert Build to template-friendly format
    const formatBuildsForTemplate = (
      builds: Build[],
      environments: string[],
    ) => {
      return builds.map((build) => ({
        id: build.buildId,
        deployments: environments.reduce(
          (acc, env) => {
            acc[env] = build.deployments[env] || null;
            return acc;
          },
          {} as Record<string, string | null>,
        ),
      }));
    };

    // GET /dashboard - Show dashboard or redirect to first service
    const dashboardHandler = async (req: FastifyRequest, res: FastifyReply) => {
      const accountId = new ObjectId(req.session!.accountId);

      // Load services from database
      const services = await serviceRepository.findByAccountId(accountId);

      // If no services, show empty dashboard
      if (services.length === 0) {
        return res.view(
          "dashboard",
          {
            services: [],
            activeService: null,
            environments: [],
            builds: [],
          },
          {
            layout: "/layouts/main.hbs",
          },
        );
      }

      // Redirect to first service
      return res.redirect(`/dashboard/${services[0].name}`);
    };

    server.get("/dashboard", dashboardHandler);
    server.get("/dashboard/", dashboardHandler);

    // GET /dashboard/:serviceName - Show specific service
    server.get<{ Params: { serviceName: string } }>(
      "/dashboard/:serviceName",
      async (
        req: FastifyRequest<{ Params: { serviceName: string } }>,
        reply: FastifyReply,
      ) => {
        const accountId = new ObjectId(req.session!.accountId);
        const { serviceName } = req.params;

        // Load all services for navigation
        const services = await serviceRepository.findByAccountId(accountId);
        const serviceNames = services.map((s) => s.name);

        // Find the active service
        const activeService = services.find((s) => s.name === serviceName);
        if (!activeService) {
          // Service not found, redirect to dashboard
          return reply.redirect("/dashboard");
        }

        // Get environment names
        const environments = activeService.environments.map((e) => e.name);

        // Load builds for this service
        const builds = await buildRepository.findByAccountAndService(
          accountId,
          activeService._id,
        );
        const formattedBuilds = formatBuildsForTemplate(builds, environments);

        // Handle HTMX partial request
        if (req.headers["hx-request"]) {
          const navigationTemplate = Handlebars.compile("{{>navigation}}");
          const navigationHtml = navigationTemplate({
            services: serviceNames,
            activeService: serviceName,
          });
          const buildTableTemplate = Handlebars.compile("{{>buildTable}}");
          const buildTableHtml = buildTableTemplate({
            serviceName: serviceName,
            environments,
            builds: formattedBuilds,
          });
          return reply
            .header("Content-Type", "text/html")
            .send(navigationHtml + buildTableHtml);
        }

        // Full page render
        return reply.view(
          "dashboard",
          {
            services: serviceNames,
            activeService: serviceName,
            environments,
            builds: formattedBuilds,
          },
          {
            layout: "/layouts/main.hbs",
          },
        );
      },
    );

    done();
  };
}
