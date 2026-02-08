import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import { ServiceRepository } from "../../repositories/serviceRepository";
import { BuildRepository, Build } from "../../repositories/buildRepository";
import { RepositoryRepository } from "../../repositories/repositoryRepository";
import { BuildService } from "../../services/build/buildService";
import { DeploymentStatus } from "../../services/service/deploymentStatus";

export type DashboardRoutesDeps = {
  serviceRepository: ServiceRepository;
  buildRepository: BuildRepository;
  repositoryRepository: RepositoryRepository;
  buildService: BuildService;
};

export default function (deps: DashboardRoutesDeps) {
  const {
    serviceRepository,
    buildRepository,
    repositoryRepository,
    buildService,
  } = deps;

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
      environments: { name: string }[],
      serviceName: string,
      serviceId: string,
    ) => {
      return builds.map((build) => ({
        id: build.buildId,
        environments, // Include environments in each build for Handlebars partial scope
        serviceName, // Include serviceName in each build for Handlebars partial scope
        serviceId, // Include serviceId for deploy button URLs
        deployments: environments.reduce(
          (acc, env) => {
            acc[env.name] = build.deployments[env.name] || null;
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

        // Get environment names, sorted by order
        const environments = [...activeService.environments]
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map((e) => ({
            name: e.name,
          }));

        // Load repository info for commit links
        const repository = await repositoryRepository.findById(
          activeService.repositoryId,
        );
        const githubFullName = repository?.githubFullName || "";

        // Load builds for this service
        const builds = await buildRepository.findByAccountAndService(
          accountId,
          activeService._id,
        );
        const formattedBuilds = formatBuildsForTemplate(
          builds,
          environments,
          serviceName,
          activeService._id.toString(),
        );

        // Check if we need to show deployment setup guide
        // Show guide when builds exist but workflow hasn't been configured yet
        // workflowConfigured may be undefined for services created before this feature
        const needsDeploymentSetup =
          builds.length > 0 && activeService.workflowConfigured !== true;

        // Handle HTMX partial request - no layout wrapper needed
        if (req.headers["hx-request"]) {
          return reply.view(
            "partials/htmxDashboard",
            {
              services: serviceNames,
              activeService: serviceName,
              serviceId: activeService._id.toString(),
              serviceName: serviceName,
              environments,
              builds: formattedBuilds,
              githubFullName,
              needsDeploymentSetup,
            },
            { layout: "" },
          );
        }

        // Full page render
        return reply.view(
          "dashboard",
          {
            services: serviceNames,
            activeService: serviceName,
            serviceId: activeService._id.toString(),
            environments,
            builds: formattedBuilds,
            githubFullName,
            needsDeploymentSetup,
          },
          {
            layout: "/layouts/main.hbs",
          },
        );
      },
    );

    // PATCH /services/:serviceId/builds/:buildId/deploy/:env - Trigger deployment from dashboard
    server.patch<{
      Params: { serviceId: string; buildId: string; env: string };
    }>(
      "/services/:serviceId/builds/:buildId/deploy/:env",
      async (
        req: FastifyRequest<{
          Params: { serviceId: string; buildId: string; env: string };
        }>,
        reply: FastifyReply,
      ) => {
        const accountId = new ObjectId(req.session!.accountId);
        const { serviceId, buildId, env } = req.params;

        // Validate serviceId format
        if (!ObjectId.isValid(serviceId)) {
          return reply.status(400).send({ error: "Invalid service ID" });
        }

        // Find the service by ID and verify ownership
        const service = await serviceRepository.findByAccountAndId(
          accountId,
          new ObjectId(serviceId),
        );
        if (!service) {
          return reply.status(404).send({ error: "Service not found" });
        }

        try {
          const build = await buildService.updateDeploymentStatus({
            accountId,
            serviceId: service._id,
            buildId,
            environment: env,
            status: DeploymentStatus.DISPATCHING,
          });

          // Return the partial for HTMX swap
          return reply.view(
            "/partials/buildEnvironmentAction.hbs",
            {
              buildId,
              status: build.deployments[env],
              env,
              serviceName: service.name,
              serviceId,
              isOobSwap: true,
            },
            { layout: "" },
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Failed to trigger deployment";
          if (
            message === "Invalid environment" ||
            message === "Invalid deployment status"
          ) {
            return reply.status(400).send({ error: message });
          }
          if (
            message === "Build not found" ||
            message === "Service not found"
          ) {
            return reply.status(404).send({ error: message });
          }
          return reply.status(500).send({ error: message });
        }
      },
    );

    done();
  };
}
