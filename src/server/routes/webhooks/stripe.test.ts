// GitLaunch Enterprise Feature — licensed under LICENSE-enterprise.md, not the FSL.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db } from "mongodb";
import Fastify, { FastifyInstance } from "fastify";
import {
  AccountRepository,
  Plan,
} from "../../../repositories/accountRepository";
import { StripeWebhookHandler } from "../../../services/billing/webhookHandler";
import {
  registerStripeWebhookRoute,
  StripeSignatureVerifier,
  StripeEvent,
} from "./stripe";
import { WebhookEventRepository } from "../../../repositories/webhookEventRepository";

describe("Stripe Webhook Route", () => {
  let mongoServer: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let app: FastifyInstance;
  let accountRepo: AccountRepository;
  let webhookHandler: StripeWebhookHandler;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    client = new MongoClient(mongoServer.getUri());
    await client.connect();
    db = client.db("test");
    accountRepo = new AccountRepository(db);
    webhookHandler = new StripeWebhookHandler(accountRepo);
  });

  afterAll(async () => {
    await client.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await db.collection("accounts").deleteMany({});
    await db.collection("webhookEvents").deleteMany({});
    app = Fastify();
    registerStripeWebhookRoute(app, {
      webhookHandler,
      webhookSecret: "whsec_test_secret",
      // Use test mode to skip signature verification
      skipSignatureVerification: true,
    });
    await app.ready();
  });

  describe("POST /webhooks/stripe", () => {
    it("should handle checkout.session.completed event with Pro plan", async () => {
      // Given: a free account
      const account = await accountRepo.create({
        name: "Checkout Org",
        slug: "checkout-org",
      });

      // When: checkout completed webhook is received with Pro plan
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/stripe",
        payload: {
          id: "evt_checkout_test",
          type: "checkout.session.completed",
          data: {
            object: {
              metadata: {
                accountId: account._id.toString(),
                plan: "pro",
              },
              customer: "cus_webhook_test",
              subscription: "sub_webhook_test",
            },
          },
        },
      });

      // Then: webhook is processed
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload).received).toBe(true);

      // And: account is upgraded to Pro
      const updated = await accountRepo.findById(account._id);
      expect(updated!.plan).toBe(Plan.Pro);
    });

    it("should handle checkout.session.completed event with Team plan", async () => {
      // Given: a free account
      const account = await accountRepo.create({
        name: "Team Checkout",
        slug: "team-checkout",
      });

      // When: checkout completed webhook is received with Team plan
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/stripe",
        payload: {
          id: "evt_team_checkout",
          type: "checkout.session.completed",
          data: {
            object: {
              metadata: {
                accountId: account._id.toString(),
                plan: "team",
              },
              customer: "cus_team_webhook",
              subscription: "sub_team_webhook",
            },
          },
        },
      });

      // Then: webhook is processed
      expect(response.statusCode).toBe(200);

      // And: account is upgraded to Team
      const updated = await accountRepo.findById(account._id);
      expect(updated!.plan).toBe(Plan.Team);
    });

    it("should default to Pro plan when metadata.plan is missing (legacy support)", async () => {
      // Given: a free account
      const account = await accountRepo.create({
        name: "Legacy Checkout",
        slug: "legacy-checkout",
      });

      // When: checkout completed webhook without plan in metadata
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/stripe",
        payload: {
          id: "evt_legacy_checkout",
          type: "checkout.session.completed",
          data: {
            object: {
              metadata: {
                accountId: account._id.toString(),
              },
              customer: "cus_legacy",
              subscription: "sub_legacy",
            },
          },
        },
      });

      // Then: webhook is processed
      expect(response.statusCode).toBe(200);

      // And: account defaults to Pro plan
      const updated = await accountRepo.findById(account._id);
      expect(updated!.plan).toBe(Plan.Pro);
    });

    it("should handle customer.subscription.deleted event", async () => {
      // Given: a Pro account
      const account = await accountRepo.create({
        name: "Cancel Org",
        slug: "cancel-org",
      });
      await accountRepo.upgradeToPlan(
        account._id,
        "cus_cancel",
        "sub_cancel",
        Plan.Pro,
      );

      // When: subscription deleted webhook is received
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/stripe",
        payload: {
          id: "evt_cancel_test",
          type: "customer.subscription.deleted",
          data: {
            object: {
              id: "sub_cancel",
            },
          },
        },
      });

      // Then: webhook is processed
      expect(response.statusCode).toBe(200);

      // And: account is downgraded
      const updated = await accountRepo.findById(account._id);
      expect(updated!.plan).toBe(Plan.Free);
    });

    it("should handle invoice.payment_failed event", async () => {
      // Given: a Pro account
      const account = await accountRepo.create({
        name: "Failed Org",
        slug: "failed-org",
      });
      await accountRepo.upgradeToPlan(
        account._id,
        "cus_failed",
        "sub_failed",
        Plan.Pro,
      );

      // When: payment failed webhook is received
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/stripe",
        payload: {
          id: "evt_failed_test",
          type: "invoice.payment_failed",
          data: {
            object: {
              subscription: "sub_failed",
              attempt_count: 1,
            },
          },
        },
      });

      // Then: webhook is processed
      expect(response.statusCode).toBe(200);

      // And: payment failure is recorded
      const updated = await accountRepo.findById(account._id);
      expect(updated!.paymentFailedAt).not.toBeNull();
    });

    it("should handle invoice.payment_succeeded event", async () => {
      // Given: an account with payment failure
      const account = await accountRepo.create({
        name: "Recover Org",
        slug: "recover-org",
      });
      await accountRepo.upgradeToPlan(
        account._id,
        "cus_recover",
        "sub_recover",
        Plan.Pro,
      );
      await accountRepo.setPaymentFailed(account._id);

      // When: payment succeeded webhook is received
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/stripe",
        payload: {
          id: "evt_recover_test",
          type: "invoice.payment_succeeded",
          data: {
            object: {
              subscription: "sub_recover",
            },
          },
        },
      });

      // Then: webhook is processed
      expect(response.statusCode).toBe(200);

      // And: payment failure is cleared
      const updated = await accountRepo.findById(account._id);
      expect(updated!.paymentFailedAt).toBeNull();
    });

    it("should return 200 for unknown event types", async () => {
      // When: unknown event type is received
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/stripe",
        payload: {
          id: "evt_unknown_test",
          type: "some.unknown.event",
          data: {
            object: {},
          },
        },
      });

      // Then: acknowledged but not processed
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload).received).toBe(true);
    });
  });

  describe("Signature Verification", () => {
    it("should return 400 when signature is missing", async () => {
      // Given: app with signature verification enabled
      const verifiedApp = Fastify();
      const mockVerifier: StripeSignatureVerifier = {
        verify: () => {
          throw new Error("Should not be called");
        },
      };
      registerStripeWebhookRoute(verifiedApp, {
        webhookHandler,
        webhookSecret: "whsec_test_secret",
        signatureVerifier: mockVerifier,
      });
      await verifiedApp.ready();

      // When: request is sent without signature header
      const response = await verifiedApp.inject({
        method: "POST",
        url: "/webhooks/stripe",
        payload: {
          id: "evt_sig_missing",
          type: "test.event",
          data: { object: {} },
        },
      });

      // Then: returns 400 for missing signature
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.payload).error).toBe(
        "Missing Stripe signature",
      );
    });

    it("should return 400 when signature is invalid", async () => {
      // Given: app with a verifier that rejects the signature
      const verifiedApp = Fastify();
      const rejectingVerifier: StripeSignatureVerifier = {
        verify: () => {
          throw new Error("Invalid signature");
        },
      };
      registerStripeWebhookRoute(verifiedApp, {
        webhookHandler,
        webhookSecret: "whsec_test_secret",
        signatureVerifier: rejectingVerifier,
      });
      await verifiedApp.ready();

      // When: request is sent with invalid signature
      const response = await verifiedApp.inject({
        method: "POST",
        url: "/webhooks/stripe",
        headers: {
          "stripe-signature": "invalid_signature",
        },
        payload: {
          id: "evt_sig_invalid",
          type: "test.event",
          data: { object: {} },
        },
      });

      // Then: returns 400 for invalid signature
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.payload).error).toBe("Invalid signature");
    });

    it("should process event when signature is valid", async () => {
      // Given: a free account and app with a verifier that accepts
      const account = await accountRepo.create({
        name: "Verified Org",
        slug: "verified-org",
      });

      const verifiedApp = Fastify();
      const validEvent: StripeEvent = {
        id: "evt_sig_valid",
        type: "checkout.session.completed",
        data: {
          object: {
            metadata: {
              accountId: account._id.toString(),
              plan: "pro",
            },
            customer: "cus_verified",
            subscription: "sub_verified",
          },
        },
      };
      const acceptingVerifier: StripeSignatureVerifier = {
        verify: () => validEvent,
      };
      registerStripeWebhookRoute(verifiedApp, {
        webhookHandler,
        webhookSecret: "whsec_test_secret",
        signatureVerifier: acceptingVerifier,
      });
      await verifiedApp.ready();

      // When: request is sent with valid signature
      const response = await verifiedApp.inject({
        method: "POST",
        url: "/webhooks/stripe",
        headers: {
          "stripe-signature": "valid_signature",
          "content-type": "application/json",
        },
        payload: JSON.stringify(validEvent),
      });

      // Then: webhook is processed
      expect(response.statusCode).toBe(200);

      // And: account is upgraded to Pro
      const updated = await accountRepo.findById(account._id);
      expect(updated!.plan).toBe(Plan.Pro);
    });
  });

  describe("Idempotent Webhook Processing", () => {
    let webhookEventRepo: WebhookEventRepository;

    beforeEach(async () => {
      webhookEventRepo = new WebhookEventRepository(db);
      await webhookEventRepo.ensureIndexes();
    });

    it("should process an event only once when sent twice", async () => {
      // Given: a free account
      const account = await accountRepo.create({
        name: "Idempotent Org",
        slug: "idempotent-org",
      });

      // And: app with webhookEventRepo
      const idempotentApp = Fastify();
      registerStripeWebhookRoute(idempotentApp, {
        webhookHandler,
        webhookSecret: "whsec_test_secret",
        skipSignatureVerification: true,
        webhookEventRepo,
      });
      await idempotentApp.ready();

      const event = {
        id: "evt_idempotent_123",
        type: "checkout.session.completed",
        data: {
          object: {
            metadata: {
              accountId: account._id.toString(),
              plan: "pro",
            },
            customer: "cus_idempotent_test",
            subscription: "sub_idempotent_test",
          },
        },
      };

      // When: the same event is sent twice
      const response1 = await idempotentApp.inject({
        method: "POST",
        url: "/webhooks/stripe",
        payload: event,
      });

      const response2 = await idempotentApp.inject({
        method: "POST",
        url: "/webhooks/stripe",
        payload: event,
      });

      // Then: both requests return 200
      expect(response1.statusCode).toBe(200);
      expect(response2.statusCode).toBe(200);
      expect(JSON.parse(response1.payload).received).toBe(true);
      expect(JSON.parse(response2.payload).received).toBe(true);

      // And: account is upgraded only once (not double-processed) to Pro
      const updated = await accountRepo.findById(account._id);
      expect(updated!.plan).toBe(Plan.Pro);
      expect(updated!.stripeCustomerId).toBe("cus_idempotent_test");
    });

    it("should record event in webhookEvents collection", async () => {
      // Given: a free account
      const account = await accountRepo.create({
        name: "Record Org",
        slug: "record-org",
      });

      // And: app with webhookEventRepo
      const recordApp = Fastify();
      registerStripeWebhookRoute(recordApp, {
        webhookHandler,
        webhookSecret: "whsec_test_secret",
        skipSignatureVerification: true,
        webhookEventRepo,
      });
      await recordApp.ready();

      // When: an event is processed
      const response = await recordApp.inject({
        method: "POST",
        url: "/webhooks/stripe",
        payload: {
          id: "evt_record_new",
          type: "checkout.session.completed",
          data: {
            object: {
              metadata: {
                accountId: account._id.toString(),
                plan: "pro",
              },
              customer: "cus_record",
              subscription: "sub_record",
            },
          },
        },
      });

      // Then: webhook is processed
      expect(response.statusCode).toBe(200);

      // And: event is recorded in the webhookEvents collection
      const recordedEvent = await db
        .collection("webhookEvents")
        .findOne({ stripeEventId: "evt_record_new" });
      expect(recordedEvent).not.toBeNull();
      expect(recordedEvent!.eventType).toBe("checkout.session.completed");
    });

    it("should acknowledge duplicate events with 200 status without re-processing", async () => {
      // Given: a free account
      const account = await accountRepo.create({
        name: "Duplicate Org",
        slug: "duplicate-org",
      });

      // And: an event that has already been processed
      await webhookEventRepo.markAsProcessed(
        "evt_dup_123",
        "checkout.session.completed",
        {
          metadata: {
            accountId: account._id.toString(),
            plan: "pro",
          },
          customer: "cus_dup",
          subscription: "sub_dup",
        },
      );

      // And: app with webhookEventRepo
      const dupApp = Fastify();
      registerStripeWebhookRoute(dupApp, {
        webhookHandler,
        webhookSecret: "whsec_test_secret",
        skipSignatureVerification: true,
        webhookEventRepo,
      });
      await dupApp.ready();

      // When: the same event arrives again
      const response = await dupApp.inject({
        method: "POST",
        url: "/webhooks/stripe",
        payload: {
          id: "evt_dup_123",
          type: "checkout.session.completed",
          data: {
            object: {
              metadata: {
                accountId: account._id.toString(),
                plan: "pro",
              },
              customer: "cus_dup",
              subscription: "sub_dup",
            },
          },
        },
      });

      // Then: response is 200 with { received: true }
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload).received).toBe(true);

      // And: account is NOT upgraded (handler was NOT called)
      const unchanged = await accountRepo.findById(account._id);
      expect(unchanged!.plan).toBe(Plan.Free);
      expect(unchanged!.stripeCustomerId).toBeFalsy();
    });
  });
});
