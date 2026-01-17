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
    it("should handle checkout.session.completed event", async () => {
      // Given: a free account
      const account = await accountRepo.create({
        name: "Checkout Org",
        slug: "checkout-org",
      });

      // When: checkout completed webhook is received
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/stripe",
        payload: {
          type: "checkout.session.completed",
          data: {
            object: {
              metadata: {
                accountId: account._id.toString(),
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

      // And: account is upgraded
      const updated = await accountRepo.findById(account._id);
      expect(updated!.plan).toBe(Plan.Paid);
    });

    it("should handle customer.subscription.deleted event", async () => {
      // Given: a paid account
      const account = await accountRepo.create({
        name: "Cancel Org",
        slug: "cancel-org",
      });
      await accountRepo.upgradeToPaid(account._id, "cus_cancel", "sub_cancel");

      // When: subscription deleted webhook is received
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/stripe",
        payload: {
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
      // Given: a paid account
      const account = await accountRepo.create({
        name: "Failed Org",
        slug: "failed-org",
      });
      await accountRepo.upgradeToPaid(account._id, "cus_failed", "sub_failed");

      // When: payment failed webhook is received
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/stripe",
        payload: {
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
      await accountRepo.upgradeToPaid(
        account._id,
        "cus_recover",
        "sub_recover",
      );
      await accountRepo.setPaymentFailed(account._id);

      // When: payment succeeded webhook is received
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/stripe",
        payload: {
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
        payload: { type: "test.event", data: { object: {} } },
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
        payload: { type: "test.event", data: { object: {} } },
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
        type: "checkout.session.completed",
        data: {
          object: {
            metadata: { accountId: account._id.toString() },
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

      // And: account is upgraded
      const updated = await accountRepo.findById(account._id);
      expect(updated!.plan).toBe(Plan.Paid);
    });
  });
});
