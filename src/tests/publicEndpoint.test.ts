import { ACCEPTANCE_TEST_URL } from "./config";
import { describe, it, expect } from "vitest";
import request from "supertest";

describe("Public folder", () => {
  it("serves js htmx library", async () => {
    const response = await request(ACCEPTANCE_TEST_URL).get(
      "/public/js/htmx.min.js",
    );
    expect(response.status).toBe(200);
  });
});
