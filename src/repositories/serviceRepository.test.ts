import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { ServiceRepository } from "./serviceRepository";

describe("ServiceRepository", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let repo: ServiceRepository;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = await MongoClient.connect(mongoServer.getUri());
    db = client.db("test");
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("services").deleteMany({});
    repo = new ServiceRepository(db);
  });

  describe("create", () => {
    it("should create a service with default environments", async () => {
      // Given
      const accountId = new ObjectId();
      const repositoryId = new ObjectId();

      // When
      const service = await repo.create({
        accountId,
        repositoryId,
        name: "backend",
      });

      // Then
      expect(service._id).toBeDefined();
      expect(service.accountId).toEqual(accountId);
      expect(service.name).toBe("backend");
      expect(service.environments).toEqual([
        { name: "staging", order: 0 },
        { name: "prod", order: 1 },
      ]);
      expect(service.deployment).toEqual({
        provider: "github",
        repositoryId,
        workflowFile: "deploy.yml",
      });
      expect(service.isActive).toBe(true);
      expect(service.createdAt).toBeInstanceOf(Date);
    });

    it("should create a service with workflowConfigured set to false by default", async () => {
      // Given
      const accountId = new ObjectId();
      const repositoryId = new ObjectId();

      // When
      const service = await repo.create({
        accountId,
        repositoryId,
        name: "my-service",
      });

      // Then
      expect(service.workflowConfigured).toBe(false);
    });

    it("should store a repoUrl for commit links", async () => {
      // Given/When: a service created with a source repo URL
      const service = await repo.create({
        accountId: new ObjectId(),
        repositoryId: new ObjectId(),
        name: "with-repo-url",
        repoUrl: "https://github.com/acme/api",
      });

      // Then: the repo URL is persisted for building commit links
      expect(service.repoUrl).toBe("https://github.com/acme/api");
    });

    it("should default repoUrl to an empty string when none is given", async () => {
      // Given/When: a service created without a repo URL
      const service = await repo.create({
        accountId: new ObjectId(),
        repositoryId: new ObjectId(),
        name: "no-repo-url",
      });

      // Then: repoUrl is a safe empty string, never undefined
      expect(service.repoUrl).toBe("");
    });

    it("should create a service born as a jenkins deployment", async () => {
      // Given/When: a provider-first Jenkins service (no repositoryId at all)
      const service = await repo.create({
        accountId: new ObjectId(),
        name: "jenkins-born",
        repoUrl: "https://github.com/acme/api",
        deployment: { provider: "jenkins", jobName: "deploy-api" },
      });

      // Then: it is a jenkins deployment with just a job name
      expect(service.deployment).toEqual({
        provider: "jenkins",
        jobName: "deploy-api",
      });
      expect(service.repoUrl).toBe("https://github.com/acme/api");
    });

    it("should create a service with no deployment when none is given", async () => {
      // Given/When: only a name + repoUrl (the onboarding step-1 shape)
      const service = await repo.create({
        accountId: new ObjectId(),
        name: "cd-pending",
        repoUrl: "https://github.com/acme/api",
      });

      // Then: CD is not configured yet (null) until the deploy-setup step
      expect(service.deployment).toBeNull();
      expect(service.repoUrl).toBe("https://github.com/acme/api");
    });

    it("should create a service born as a raw webhook deployment", async () => {
      // Given/When: a raw deployment (GitLaunch POSTs to a customer endpoint)
      const service = await repo.create({
        accountId: new ObjectId(),
        name: "raw-born",
        repoUrl: "https://github.com/acme/api",
        deployment: {
          provider: "raw",
          endpointUrl: "https://deploy.acme.com/hook",
        },
      });

      // Then: it is a raw deployment carrying the endpoint
      expect(service.deployment).toEqual({
        provider: "raw",
        endpointUrl: "https://deploy.acme.com/hook",
      });
    });

    it("should create a service with custom environments", async () => {
      // Given
      const accountId = new ObjectId();
      const repositoryId = new ObjectId();
      const customEnvs = [
        { name: "dev", order: 0 },
        { name: "staging", order: 1 },
        { name: "prod", order: 2 },
      ];

      // When
      const service = await repo.create({
        accountId,
        repositoryId,
        name: "frontend",
        environments: customEnvs,
        workflowFile: "deploy-frontend.yml",
      });

      // Then
      expect(service.environments).toEqual(customEnvs);
      expect(service.deployment).toEqual({
        provider: "github",
        repositoryId,
        workflowFile: "deploy-frontend.yml",
      });
    });
  });

  describe("findById", () => {
    it("should find a service by id", async () => {
      // Given
      const accountId = new ObjectId();
      const repositoryId = new ObjectId();
      const created = await repo.create({
        accountId,
        repositoryId,
        name: "api",
      });

      // When
      const found = await repo.findById(created._id);

      // Then
      expect(found).not.toBeNull();
      expect(found?.name).toBe("api");
    });

    it("should return null for non-existent id", async () => {
      // When
      const found = await repo.findById(new ObjectId());

      // Then
      expect(found).toBeNull();
    });
  });

  describe("findByAccountAndId", () => {
    it("should find a service by account and id", async () => {
      // Given
      const accountId = new ObjectId();
      const repositoryId = new ObjectId();
      const created = await repo.create({
        accountId,
        repositoryId,
        name: "worker",
      });

      // When
      const found = await repo.findByAccountAndId(accountId, created._id);

      // Then
      expect(found).not.toBeNull();
      expect(found?.name).toBe("worker");
    });

    it("should return null when account does not match", async () => {
      // Given
      const accountId = new ObjectId();
      const otherAccountId = new ObjectId();
      const repositoryId = new ObjectId();
      const created = await repo.create({
        accountId,
        repositoryId,
        name: "service",
      });

      // When
      const found = await repo.findByAccountAndId(otherAccountId, created._id);

      // Then
      expect(found).toBeNull();
    });
  });

  describe("findByRepositoryId", () => {
    it("should find all services for a repository", async () => {
      // Given
      const accountId = new ObjectId();
      const repositoryId = new ObjectId();
      await repo.create({ accountId, repositoryId, name: "frontend" });
      await repo.create({ accountId, repositoryId, name: "backend" });
      await repo.create({ accountId, repositoryId, name: "worker" });

      // When
      const services = await repo.findByRepositoryId(accountId, repositoryId);

      // Then
      expect(services).toHaveLength(3);
      expect(services.map((s) => s.name).sort()).toEqual([
        "backend",
        "frontend",
        "worker",
      ]);
    });

    it("should only return services for the specified account", async () => {
      // Given
      const accountId = new ObjectId();
      const otherAccountId = new ObjectId();
      const repositoryId = new ObjectId();
      await repo.create({ accountId, repositoryId, name: "my-service" });
      await repo.create({
        accountId: otherAccountId,
        repositoryId,
        name: "other-service",
      });

      // When
      const services = await repo.findByRepositoryId(accountId, repositoryId);

      // Then
      expect(services).toHaveLength(1);
      expect(services[0].name).toBe("my-service");
    });

    it("should return empty array when no services exist", async () => {
      // When
      const services = await repo.findByRepositoryId(
        new ObjectId(),
        new ObjectId(),
      );

      // Then
      expect(services).toEqual([]);
    });
  });

  describe("updateWorkflowConfiguration", () => {
    it("should update workflow file", async () => {
      // Given: a service exists
      const accountId = new ObjectId();
      const repositoryId = new ObjectId();
      const service = await repo.create({
        accountId,
        repositoryId,
        name: "update-workflow-test",
      });

      // When: I update workflow configuration
      const updated = await repo.updateWorkflowConfiguration(service._id, {
        workflowFile: "deploy-prod.yml",
      });

      // Then: workflowFile is updated, dispatch-target repo preserved
      expect(updated).not.toBeNull();
      expect(updated?.deployment).toEqual({
        provider: "github",
        repositoryId,
        workflowFile: "deploy-prod.yml",
      });
    });

    it("should set workflowConfigured to true", async () => {
      // Given: a service exists with workflowConfigured=false
      const accountId = new ObjectId();
      const repositoryId = new ObjectId();
      const service = await repo.create({
        accountId,
        repositoryId,
        name: "workflow-config-test",
      });
      expect(service.workflowConfigured).toBe(false);

      // When: I update workflow configuration
      const updated = await repo.updateWorkflowConfiguration(service._id, {
        workflowFile: "deploy.yml",
      });

      // Then: workflowConfigured is set to true
      expect(updated?.workflowConfigured).toBe(true);
    });

    it("should return null if service not found", async () => {
      // Given: a non-existent service ID
      const fakeId = new ObjectId();

      // When: I update workflow configuration
      const result = await repo.updateWorkflowConfiguration(fakeId, {
        workflowFile: "deploy.yml",
      });

      // Then: null is returned
      expect(result).toBeNull();
    });

    it("should only update specified fields", async () => {
      // Given: a service with custom environments
      const accountId = new ObjectId();
      const repositoryId = new ObjectId();
      const service = await repo.create({
        accountId,
        repositoryId,
        name: "partial-update-test",
        environments: [{ name: "dev", order: 0 }],
      });

      // When: I update workflow configuration
      const updated = await repo.updateWorkflowConfiguration(service._id, {
        workflowFile: "new-workflow.yml",
      });

      // Then: environments are not changed
      expect(updated?.environments).toEqual([{ name: "dev", order: 0 }]);
      expect(updated?.name).toBe("partial-update-test");
    });
  });

  describe("ensureIndexes", () => {
    it("should enforce a unique service name per account", async () => {
      // Given: a service named "api" in an account
      await repo.ensureIndexes();
      const accountId = new ObjectId();
      await repo.create({
        accountId,
        repositoryId: new ObjectId(),
        name: "api",
      });

      // When/Then: a second "api" in the same account fails, even from a
      // different source repo (dashboard routes by name, so names must be unique)
      await expect(
        repo.create({
          accountId,
          repositoryId: new ObjectId(),
          name: "api",
        }),
      ).rejects.toThrow();
    });
  });

  describe("addEnvironment", () => {
    it("should add an environment to the service", async () => {
      // Given: a service with default environments
      const accountId = new ObjectId();
      const repositoryId = new ObjectId();
      const service = await repo.create({
        accountId,
        repositoryId,
        name: "add-env-test",
      });
      expect(service.environments).toHaveLength(2);

      // When: I add a new environment
      const newEnv = { name: "dev", order: -1 };
      const updated = await repo.addEnvironment(service._id, newEnv);

      // Then: the environment is added
      expect(updated).not.toBeNull();
      expect(updated?.environments).toHaveLength(3);
      expect(updated?.environments).toContainEqual(newEnv);
    });

    it("should return null if service not found", async () => {
      // Given: a non-existent service ID
      const fakeId = new ObjectId();

      // When: I try to add an environment
      const result = await repo.addEnvironment(fakeId, {
        name: "dev",
        order: 0,
      });

      // Then: null is returned
      expect(result).toBeNull();
    });
  });

  describe("updateEnvironment", () => {
    it("should update an existing environment's order", async () => {
      // Given: a service with default environments
      const accountId = new ObjectId();
      const repositoryId = new ObjectId();
      const service = await repo.create({
        accountId,
        repositoryId,
        name: "update-order-test",
      });

      // When: I update the staging environment's order
      const updated = await repo.updateEnvironment(service._id, "staging", {
        order: 5,
      });

      // Then: the order is updated
      expect(updated).not.toBeNull();
      const stagingEnv = updated?.environments.find(
        (e) => e.name === "staging",
      );
      expect(stagingEnv?.order).toBe(5);
    });

    it("should return null if service not found", async () => {
      // Given: a non-existent service ID
      const fakeId = new ObjectId();

      // When: I try to update an environment
      const result = await repo.updateEnvironment(fakeId, "staging", {
        order: 5,
      });

      // Then: null is returned
      expect(result).toBeNull();
    });

    it("should return unchanged service if environment not found", async () => {
      // Given: a service without a "dev" environment
      const accountId = new ObjectId();
      const repositoryId = new ObjectId();
      const service = await repo.create({
        accountId,
        repositoryId,
        name: "no-env-test",
      });

      // When: I try to update non-existent environment
      const updated = await repo.updateEnvironment(service._id, "dev", {
        order: 5,
      });

      // Then: service is returned but unchanged (no env named "dev")
      expect(updated).not.toBeNull();
      expect(updated?.environments).toHaveLength(2);
      expect(
        updated?.environments.find((e) => e.name === "dev"),
      ).toBeUndefined();
    });
  });

  describe("removeEnvironment", () => {
    it("should remove an environment from the service", async () => {
      // Given: a service with default environments (staging, prod)
      const accountId = new ObjectId();
      const repositoryId = new ObjectId();
      const service = await repo.create({
        accountId,
        repositoryId,
        name: "remove-env-test",
      });
      expect(service.environments).toHaveLength(2);

      // When: I remove the staging environment
      const updated = await repo.removeEnvironment(service._id, "staging");

      // Then: the environment is removed
      expect(updated).not.toBeNull();
      expect(updated?.environments).toHaveLength(1);
      expect(
        updated?.environments.find((e) => e.name === "staging"),
      ).toBeUndefined();
      expect(
        updated?.environments.find((e) => e.name === "prod"),
      ).toBeDefined();
    });

    it("should return null if service not found", async () => {
      // Given: a non-existent service ID
      const fakeId = new ObjectId();

      // When: I try to remove an environment
      const result = await repo.removeEnvironment(fakeId, "staging");

      // Then: null is returned
      expect(result).toBeNull();
    });

    it("should return unchanged service if environment not found", async () => {
      // Given: a service without a "dev" environment
      const accountId = new ObjectId();
      const repositoryId = new ObjectId();
      const service = await repo.create({
        accountId,
        repositoryId,
        name: "no-remove-env-test",
      });

      // When: I try to remove non-existent environment
      const updated = await repo.removeEnvironment(service._id, "dev");

      // Then: service is returned unchanged
      expect(updated).not.toBeNull();
      expect(updated?.environments).toHaveLength(2);
    });
  });

  describe("markWorkflowConfigured", () => {
    it("should set workflowConfigured to true", async () => {
      // Given: a service with workflowConfigured=false
      const accountId = new ObjectId();
      const repositoryId = new ObjectId();
      const service = await repo.create({
        accountId,
        repositoryId,
        name: "auto-configure-test",
      });
      expect(service.workflowConfigured).toBe(false);

      // When: I mark workflow as configured
      await repo.markWorkflowConfigured(service._id);

      // Then: workflowConfigured is set to true
      const updated = await repo.findById(service._id);
      expect(updated?.workflowConfigured).toBe(true);
    });

    it("should not modify other fields", async () => {
      // Given: a service with custom configuration
      const accountId = new ObjectId();
      const repositoryId = new ObjectId();
      const service = await repo.create({
        accountId,
        repositoryId,
        name: "preserve-fields-test",
        workflowFile: "custom-deploy.yml",
        environments: [{ name: "dev", order: 0 }],
      });

      // When: I mark workflow as configured
      await repo.markWorkflowConfigured(service._id);

      // Then: other fields are preserved
      const updated = await repo.findById(service._id);
      expect(updated?.deployment).toEqual({
        provider: "github",
        repositoryId,
        workflowFile: "custom-deploy.yml",
      });
      expect(updated?.name).toBe("preserve-fields-test");
      expect(updated?.environments).toEqual([{ name: "dev", order: 0 }]);
    });
  });

  describe("delete", () => {
    it("should delete a service by id", async () => {
      // Given: a service exists
      const accountId = new ObjectId();
      const repositoryId = new ObjectId();
      const service = await repo.create({
        accountId,
        repositoryId,
        name: "delete-test",
      });

      // When: I delete the service
      const deleted = await repo.delete(service._id);

      // Then: the service is deleted
      expect(deleted).toBe(true);
      const found = await repo.findById(service._id);
      expect(found).toBeNull();
    });

    it("should return false if service not found", async () => {
      // Given: a non-existent service ID
      const fakeId = new ObjectId();

      // When: I try to delete it
      const deleted = await repo.delete(fakeId);

      // Then: returns false
      expect(deleted).toBe(false);
    });

    it("should only delete the specified service", async () => {
      // Given: multiple services exist
      const accountId = new ObjectId();
      const repositoryId = new ObjectId();
      const service1 = await repo.create({
        accountId,
        repositoryId,
        name: "service-1",
      });
      const service2 = await repo.create({
        accountId,
        repositoryId,
        name: "service-2",
      });

      // When: I delete service1
      await repo.delete(service1._id);

      // Then: only service1 is deleted
      expect(await repo.findById(service1._id)).toBeNull();
      expect(await repo.findById(service2._id)).not.toBeNull();
    });
  });

  describe("deployment configuration", () => {
    it("should default new services to a github deployment carrying the repo", async () => {
      // When: I create a service
      const repositoryId = new ObjectId();
      const service = await repo.create({
        accountId: new ObjectId(),
        repositoryId,
        name: "defaults",
      });

      // Then: it deploys via GitHub Actions by default, dispatch target in-variant
      expect(service.deployment).toEqual({
        provider: "github",
        repositoryId,
        workflowFile: "deploy.yml",
      });
    });

    it("marks the service workflow-configured — setting a deployment IS configuring it", async () => {
      // Given: a report-only service (no deployment, not yet configured)
      const created = await repo.create({
        accountId: new ObjectId(),
        name: "cfg-on-set",
      });
      expect(created.workflowConfigured).toBe(false);

      // When: a deployment is explicitly set (e.g. from deploy setup)
      await repo.setDeployment(created.accountId, created._id, {
        provider: "github",
        repositoryId: new ObjectId(),
        workflowFile: "deploy.yml",
      });

      // Then: it counts as configured, so the dashboard won't re-nag setup
      const updated = await repo.findById(created._id);
      expect(updated?.workflowConfigured).toBe(true);
    });

    it("should switch a service to a jenkins deployment with a job name", async () => {
      // Given: a service
      const created = await repo.create({
        accountId: new ObjectId(),
        repositoryId: new ObjectId(),
        name: "to-jenkins",
      });

      // When: I switch it to Jenkins
      await repo.setDeployment(created.accountId, created._id, {
        provider: "jenkins",
        jobName: "deploy-backend",
      });

      // Then: the deployment becomes a jenkins variant carrying the job name
      // (and no repositoryId — Jenkins has no dispatch-target repo)
      const updated = await repo.findById(created._id);
      expect(updated?.deployment).toEqual({
        provider: "jenkins",
        jobName: "deploy-backend",
      });
    });

    it("should switch a service back to a github deployment with a fresh repo", async () => {
      // Given: a Jenkins service
      const created = await repo.create({
        accountId: new ObjectId(),
        repositoryId: new ObjectId(),
        name: "back-to-gh",
      });
      await repo.setDeployment(created.accountId, created._id, {
        provider: "jenkins",
        jobName: "deploy-backend",
      });

      // When: I switch back to GitHub Actions with a dispatch-target repo
      const newRepoId = new ObjectId();
      await repo.setDeployment(created.accountId, created._id, {
        provider: "github",
        repositoryId: newRepoId,
        workflowFile: "deploy.yml",
      });

      // Then: it is a github deployment (a jobName cannot exist on this variant)
      const updated = await repo.findById(created._id);
      expect(updated?.deployment).toEqual({
        provider: "github",
        repositoryId: newRepoId,
        workflowFile: "deploy.yml",
      });
    });

    it("should keep repoUrl across a provider switch (commit links survive)", async () => {
      // Given: a github service with a source repo URL for commit links
      const created = await repo.create({
        accountId: new ObjectId(),
        repositoryId: new ObjectId(),
        name: "keeps-repo-url",
        repoUrl: "https://github.com/acme/api",
      });

      // When: I switch it to Jenkins (dropping the GitHub dispatch target)
      await repo.setDeployment(created.accountId, created._id, {
        provider: "jenkins",
        jobName: "deploy-backend",
      });

      // Then: repoUrl is untouched — every build still links to a commit
      const updated = await repo.findById(created._id);
      expect(updated?.repoUrl).toBe("https://github.com/acme/api");
    });

    it("should read a legacy github service (flat fields) as a github deployment", async () => {
      // Given: a pre-existing document with the legacy flat dispatch fields
      const repositoryId = new ObjectId();
      const raw = {
        accountId: new ObjectId(),
        repositoryId,
        name: "legacy-github",
        environments: [],
        workflowFile: "ship.yml",
        workflowConfigured: false,
        isActive: true,
        ciProvider: "github",
        jobName: null,
        createdAt: new Date(),
      };
      const { insertedId } = await db.collection("services").insertOne(raw);

      // When: I read it back
      const service = await repo.findById(insertedId);

      // Then: the flat fields become a github variant, repo folded into it
      expect(service?.deployment).toEqual({
        provider: "github",
        repositoryId,
        workflowFile: "ship.yml",
      });
    });

    it("should fold a Stage 2 top-level repositoryId into the github variant", async () => {
      // Given: a Stage 2 document — deployment exists but repositoryId is still
      // at the top level (not yet inside the variant)
      const repositoryId = new ObjectId();
      const raw = {
        accountId: new ObjectId(),
        repositoryId,
        name: "stage2-github",
        environments: [],
        workflowConfigured: true,
        isActive: true,
        repoUrl: "",
        deployment: { provider: "github", workflowFile: "ship.yml" },
        createdAt: new Date(),
      };
      const { insertedId } = await db.collection("services").insertOne(raw);

      // When: I read it back
      const service = await repo.findById(insertedId);

      // Then: the top-level repo is folded into the github variant
      expect(service?.deployment).toEqual({
        provider: "github",
        repositoryId,
        workflowFile: "ship.yml",
      });
    });

    it("should read a legacy jenkins service (flat fields) as a jenkins deployment", async () => {
      // Given: a pre-existing jenkins document with flat fields
      const raw = {
        accountId: new ObjectId(),
        repositoryId: new ObjectId(),
        name: "legacy-jenkins",
        environments: [],
        workflowFile: "deploy.yml",
        workflowConfigured: false,
        isActive: true,
        ciProvider: "jenkins",
        jobName: "legacy-job",
        createdAt: new Date(),
      };
      const { insertedId } = await db.collection("services").insertOne(raw);

      // When: I read it back
      const service = await repo.findById(insertedId);

      // Then: it becomes a jenkins deployment variant
      expect(service?.deployment).toEqual({
        provider: "jenkins",
        jobName: "legacy-job",
      });
    });
  });
});
