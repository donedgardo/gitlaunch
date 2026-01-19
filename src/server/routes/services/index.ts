import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { AccountRepository } from "../../../repositories/accountRepository";
import { RepositoryRepository } from "../../../repositories/repositoryRepository";
import { ServiceRepository } from "../../../repositories/serviceRepository";
import { ApiKeyService } from "../../../services/apiKey/apiKeyService";

export type ServiceRoutesDeps = {
  accountRepository: AccountRepository;
  repositoryRepository: RepositoryRepository;
  serviceRepository: ServiceRepository;
  apiKeyService: ApiKeyService;
};

export function registerServiceRoutes(
  app: FastifyInstance,
  deps: ServiceRoutesDeps,
): void {
  const {
    accountRepository,
    repositoryRepository,
    serviceRepository,
    apiKeyService,
  } = deps;

  // GET /services/new - Show create service form
  app.get(
    "/services/new",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Redirect to login if not authenticated
      if (!request.session) {
        return reply.redirect("/auth/github");
      }

      // Get account from session
      const account = await accountRepository.findById(
        new ObjectId(request.session.accountId),
      );
      if (!account) {
        return reply.redirect("/auth/github");
      }

      // Get repositories for this account
      const repositories = await repositoryRepository.findByAccountId(
        account._id,
      );

      // If no repositories, redirect to onboarding
      if (repositories.length === 0) {
        return reply.redirect("/onboarding");
      }

      return reply.view(
        "services/new",
        {
          title: "Create Service",
          repositories,
        },
        { layout: "/layouts/main.hbs" },
      );
    },
  );

  // POST /services/new - Create a new service
  app.post<{
    Body: {
      repositoryId: string;
      name: string;
    };
  }>(
    "/services/new",
    async (
      request: FastifyRequest<{
        Body: { repositoryId: string; name: string };
      }>,
      reply: FastifyReply,
    ) => {
      // Redirect to login if not authenticated
      if (!request.session) {
        return reply.redirect("/auth/github");
      }

      // Get account from session
      const account = await accountRepository.findById(
        new ObjectId(request.session.accountId),
      );
      if (!account) {
        return reply.redirect("/auth/github");
      }

      const { repositoryId, name } = request.body;

      // Validate required fields
      if (!repositoryId || !name) {
        const repositories = await repositoryRepository.findByAccountId(
          account._id,
        );
        return reply.view(
          "services/new",
          {
            title: "Create Service",
            repositories,
            error: "Please select a repository and enter a service name.",
          },
          { layout: "/layouts/main.hbs" },
        );
      }

      // Verify repository belongs to account
      const repository = await repositoryRepository.findById(
        new ObjectId(repositoryId),
      );
      if (!repository || !repository.accountId.equals(account._id)) {
        const repositories = await repositoryRepository.findByAccountId(
          account._id,
        );
        return reply.view(
          "services/new",
          {
            title: "Create Service",
            repositories,
            error: "Invalid repository selected.",
          },
          { layout: "/layouts/main.hbs" },
        );
      }

      // Create the service
      try {
        const service = await serviceRepository.create({
          accountId: account._id,
          repositoryId: new ObjectId(repositoryId),
          name: name.trim(),
        });

        // Generate API key for this service
        const { key } = await apiKeyService.generate({
          accountId: account._id,
          createdByUserId: new ObjectId(request.session.userId),
          name: `${name.trim()} API Key`,
          scopes: ["builds:read", "builds:write", "deployments:write"],
        });

        // Store API key in a signed, short-lived cookie (not in URL for security)
        reply.setCookie("service_api_key", key, {
          signed: true,
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          path: "/services/created",
          maxAge: 300, // 5 minutes - just enough time to view and copy
        });

        // Store service info in cookie for the created page
        reply.setCookie(
          "created_service",
          JSON.stringify({
            id: service._id.toString(),
            name: service.name,
          }),
          {
            signed: true,
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            path: "/services/created",
            maxAge: 300,
          },
        );

        // Redirect to service created page
        return reply.redirect("/services/created");
      } catch (error: any) {
        // Handle duplicate service name error
        if (error.code === 11000) {
          const repositories = await repositoryRepository.findByAccountId(
            account._id,
          );
          return reply.view(
            "services/new",
            {
              title: "Create Service",
              repositories,
              error:
                "A service with this name already exists for this repository.",
            },
            { layout: "/layouts/main.hbs" },
          );
        }
        throw error;
      }
    },
  );

  // GET /services/created - Show API key and getting started guide
  app.get(
    "/services/created",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Redirect to login if not authenticated
      if (!request.session) {
        return reply.redirect("/auth/github");
      }

      // Get API key from signed cookie
      const apiKeyCookie = request.cookies.service_api_key;
      const apiKey = apiKeyCookie
        ? reply.unsignCookie(apiKeyCookie).value
        : null;

      // Get service info from signed cookie
      const serviceCookie = request.cookies.created_service;
      const serviceInfoRaw = serviceCookie
        ? reply.unsignCookie(serviceCookie).value
        : null;

      // Clear cookies immediately (one-time display)
      reply.clearCookie("service_api_key", { path: "/services/created" });
      reply.clearCookie("created_service", { path: "/services/created" });

      // If no API key or service info (already viewed or expired), redirect to dashboard
      if (!apiKey || !serviceInfoRaw) {
        return reply.redirect("/dashboard");
      }

      const serviceInfo = JSON.parse(serviceInfoRaw);

      return reply.view(
        "services/created",
        {
          title: "Service Created",
          apiKey,
          serviceId: serviceInfo.id,
          serviceName: serviceInfo.name,
        },
        { layout: "/layouts/main.hbs" },
      );
    },
  );
}
