import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveApiKey, resolveBaseUrl } from "../../src/config/resolve.js";
import { OctenAuthError } from "../../src/api/errors.js";
import { writeCredentials, readCredentials, CREDENTIALS_VERSION, type Credentials } from "../../src/auth/store.js";

const H = () => mkdtempSync(join(tmpdir(), "octen-resolve-"));

/** A valid source:"login" credential with sensible defaults, overridable per test. */
function loginCreds(overrides: Partial<Extract<Credentials, { source: "login" }>>): Credentials {
  return {
    version: CREDENTIALS_VERSION,
    source: "login",
    issuer: "https://auth.octen.ai",
    resource: "https://cli.octen.ai",
    apiKey: "stored",
    apiKeyExpiresAt: null,
    grantId: "grant-1",
    ...overrides,
  };
}

describe("resolve", () => {
  it("prefers --api-key flag over env", () => {
    expect(resolveApiKey("flagkey", { OCTEN_API_KEY: "envkey" })).toBe("flagkey");
  });
  it("falls back to env", () => {
    expect(resolveApiKey(undefined, { OCTEN_API_KEY: "envkey" })).toBe("envkey");
  });
  it("throws OctenAuthError when missing", () => {
    expect(() => resolveApiKey(undefined, {})).toThrow(OctenAuthError);
  });
  it("resolves base url flag > env > default", () => {
    expect(resolveBaseUrl("https://f", {})).toBe("https://f");
    expect(resolveBaseUrl(undefined, { OCTEN_API_URL: "https://e" })).toBe("https://e");
    expect(resolveBaseUrl(undefined, {})).toBe("https://api.octen.ai");
  });

  it("flag beats env beats the login store", () => {
    const h = H();
    writeCredentials(h, loginCreds({ apiKey: "stored" }));
    expect(resolveApiKey("flagged", { OCTEN_API_KEY: "envd" }, { home: h })).toBe("flagged");
    expect(resolveApiKey(undefined, { OCTEN_API_KEY: "envd" }, { home: h })).toBe("envd");
    expect(resolveApiKey(undefined, {}, { home: h })).toBe("stored");
  });

  it("does not read the file at all when flag or env is present", () => {
    // Explicit input must always win, and must not pay the cost of a file read.
    // A nonexistent home would blow up on any attempt to read it, so this only
    // passes if steps 1/2 never touch the disk.
    expect(resolveApiKey("flagged", {}, { home: "/nonexistent" })).toBe("flagged");
    expect(resolveApiKey(undefined, { OCTEN_API_KEY: "envd" }, { home: "/nonexistent" })).toBe("envd");
  });

  it("ignores credentials issued by a different issuer than the current environment", () => {
    // Logged in against prod, then OCTEN_AUTH_ISSUER points elsewhere for local
    // testing — that credential belongs to another environment. It must not be
    // used, and it must not be deleted: this resolution doesn't own that file.
    const h = H();
    writeCredentials(h, loginCreds({ issuer: "https://auth.octen.ai" }));
    expect(() =>
      resolveApiKey(undefined, { OCTEN_AUTH_ISSUER: "http://127.0.0.1:8080" }, { home: h }),
    ).toThrow(OctenAuthError);
    expect(readCredentials(h)).toBeDefined();
  });

  it("ignores credentials issued for a different resource than the current environment", () => {
    const h = H();
    writeCredentials(h, loginCreds({ resource: "https://cli.octen.ai" }));
    expect(() =>
      resolveApiKey(undefined, { OCTEN_AUTH_RESOURCE: "https://other.octen.ai" }, { home: h }),
    ).toThrow(OctenAuthError);
    expect(readCredentials(h)).toBeDefined();
  });

  it("honours a non-null apiKeyExpiresAt by asking the user to log in again", () => {
    // F8's forward-compatibility behaviour. The server always returns
    // expires_at: null today, so this never fires yet — but it must be ready
    // for the day it does.
    const h = H();
    writeCredentials(h, loginCreds({ apiKeyExpiresAt: Math.floor(Date.now() / 1000) - 10 }));
    expect(() => resolveApiKey(undefined, {}, { home: h })).toThrow(/octen login/);
  });

  it("the error names both ways out when nothing is available", () => {
    const err = (() => {
      try {
        resolveApiKey(undefined, {}, { home: H() });
      } catch (e) {
        return e as Error;
      }
    })()!;
    expect(err).toBeInstanceOf(OctenAuthError);
    expect(err.message).toMatch(/octen login/);
    expect(err.message).toMatch(/OCTEN_API_KEY/);
  });
});
