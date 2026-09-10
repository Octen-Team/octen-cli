import { describe, it, expect } from "vitest";
import { CLI_CLIENT_ID, CLI_SCOPE, authIssuer, authResource } from "../../src/auth/constants.js";

describe("auth constants", () => {
  it("pins the client id and scope to the server's seeded client row", () => {
    // These two strings must byte-match the pre-registered `octen-cli`
    // client on the authorization server. Nothing else in the suite fails
    // if they drift: a typo surfaces only as an invalid_scope /
    // invalid_client from the real AS, at the first live link-up.
    expect(CLI_CLIENT_ID).toBe("octen-cli");
    expect(CLI_SCOPE).toBe("octen:api_key");
  });

  it("issuer and resource default to production and honour env overrides", () => {
    expect(authIssuer({})).toBe("https://auth.octen.ai");
    expect(authResource({})).toBe("https://cli.octen.ai");
    // Local dev points at a local AS. pre and prod share auth.octen.ai
    // — there is no auth.pre.octen.ai, so don't invent one by analogy with
    // the other per-environment hostnames; it just fails to resolve.
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

  // 这两条钉住的是一个已经实测出过泄漏的路径：`exchange.ts` 把 access token、
  // `revoke.ts` 把账户级长期 API key 发到 issuer 指向的任何主机。此前 authIssuer
  // 只拒尾斜杠，`OCTEN_AUTH_ISSUER=http://…` 会让两者明文上线且无任何提示。
  it("a non-loopback plaintext issuer is rejected", () => {
    expect(() => authIssuer({ OCTEN_AUTH_ISSUER: "http://auth-staging.internal" })).toThrow(
      /must use https/,
    );
    expect(() => authIssuer({ OCTEN_AUTH_ISSUER: "http://localhost:8080" })).toThrow(
      // localhost 不算 loopback 豁免：它可以被 hosts 文件改指向（RFC 8252 §8.3）。
      /must use https/,
    );
  });

  it("http on a loopback literal stays allowed — local development depends on it", () => {
    expect(authIssuer({ OCTEN_AUTH_ISSUER: "http://127.0.0.1:8080" })).toBe("http://127.0.0.1:8080");
    expect(authIssuer({ OCTEN_AUTH_ISSUER: "http://[::1]:8080" })).toBe("http://[::1]:8080");
  });

  it("an issuer that is not an absolute URL, or carries userinfo, is rejected", () => {
    expect(() => authIssuer({ OCTEN_AUTH_ISSUER: "auth.octen.ai" })).toThrow(/absolute URL/);
    expect(() => authIssuer({ OCTEN_AUTH_ISSUER: "https://u:p@auth.octen.ai" })).toThrow(
      /must not contain credentials/,
    );
  });

  // resource 不受 https 规则约束，理由是它从不被拨号——只作为 audience 逐字节比较。
  it("the resource is an identifier, not an origin: no https rule applies", () => {
    expect(authResource({ OCTEN_AUTH_RESOURCE: "http://cli.example" })).toBe("http://cli.example");
  });
});
