import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { AccountRepository } from "../../../repositories/accountRepository";
import { RepositoryRepository } from "../../../repositories/repositoryRepository";
import { ServiceRepository } from "../../../repositories/serviceRepository";

export type ServiceRoutesDeps = {
  accountRepository: AccountRepository;
  repositoryRepository: RepositoryRepository;
  serviceRepository: ServiceRepository;
};

export function registerServiceRoutes(
  app: FastifyInstance,
  deps: ServiceRoutesDeps,
): void {
  const { accountRepository, repositoryRepository, serviceRepository } = deps;

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
        await serviceRepository.create({
          accountId: account._id,
          repositoryId: new ObjectId(repositoryId),
          name: name.trim(),
        });

        // Redirect to dashboard
        return reply.redirect(`/dashboard`);
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
}
