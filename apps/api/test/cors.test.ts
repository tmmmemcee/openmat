import { describe, expect, it } from "vitest";
import { app } from "./helpers.js";

describe("cross-origin access", () => {
  it("allows the official web app without any configuration", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/demo",
      headers: { origin: "https://openmat-web.onrender.com", "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" },
    });
    expect(res.headers["access-control-allow-origin"]).toBe("https://openmat-web.onrender.com");
    const get = await app.inject({ url: "/api/health", headers: { origin: "https://openmat-web.onrender.com" } });
    expect(get.headers["access-control-allow-origin"]).toBe("https://openmat-web.onrender.com");
  });

  it("doesn't allow other sites", async () => {
    const res = await app.inject({ url: "/api/health", headers: { origin: "https://evil.example" } });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
