import { describe, it, expect } from "vitest";
import { authIssuer, authResource } from "../../src/auth/constants.js";

describe("auth constants", () => {
  it("issuer and resource default to production and honour env overrides", () => {
    expect(authIssuer({})).toBe("https://auth.octen.ai");
    expect(authResource({})).toBe("https://cli.octen.ai");
    // Local dev points at a local AS. pre and prod share auth.octen.ai
    // (configs/pre.config.yaml:1365) — there is no auth.pre.octen.ai, don't invent one.
    expect(authIssuer({ OCTEN_AUTH_ISSUER: "http://127.0.0.1:8080" })).toBe("http://127.0.0.1:8080");
  });

  it("a trailing slash on the issuer throws instead of being trimmed", () => {
    // octen-mcp 0.5.0 turned a trailing slash into a JWKS URL of //api/oauth/jwks
    // and made the byte-for-byte issuer comparison fail. Loud failure beats silent correction.
    expect(() => authIssuer({ OCTEN_AUTH_ISSUER: "https://auth.octen.ai/" })).toThrow();
  });

  it("a trailing slash on the resource throws instead of being trimmed", () => {
    expect(() => authResource({ OCTEN_AUTH_RESOURCE: "https://cli.octen.ai/" })).toThrow();
  });
});
