import { ACCEPTANCE_TEST_URL } from "./config";
import { describe, it, expect } from "vitest";
import request from "supertest";

describe("Smoke Test", () => {
  it("checks if the server responds to the health check", async () => {
    const response = await request(ACCEPTANCE_TEST_URL).get("/health");
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("OK");
  });
});
