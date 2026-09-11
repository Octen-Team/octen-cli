import { describe, it, expect } from "vitest";
import { mkdtempSync, statSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { platform } from "node:os";
import {
  CREDENTIALS_VERSION,
  credentialsPath,
  readCredentials,
  writeCredentials,
  deleteCredentials,
  type Credentials,
} from "../../src/auth/store.js";
import { OctenValidationError } from "../../src/api/errors.js";

const H = () => mkdtempSync(join(tmpdir(), "octen-store-"));

/**
 * The plan's tests reference this helper without defining it: a valid
 * source:"login" credential with sensible defaults, overridable per test.
 */
function loginCreds(overrides: Partial<Extract<Credentials, { source: "login" }>>): Credentials {
  return {
    version: CREDENTIALS_VERSION,
    source: "login",
    issuer: "https://auth.octen.ai",
    resource: "https://cli.octen.ai",
    apiKey: "k",
    apiKeyExpiresAt: null,
    grantId: "grant-1",
    ...overrides,
  };
}

describe("credential store", () => {
  it("writes with 0600, leaves no temp file, and round-trips", () => {
    const h = H();
    writeCredentials(h, { version: 1, source: "api-key", apiKey: "k" });
    // Windows has no POSIX permission bits; the mode assertion only applies on POSIX.
    if (platform() !== "win32") {
      expect(statSync(credentialsPath(h)).mode & 0o777).toBe(0o600);
    }
    expect(readdirSync(join(h, ".octen")).filter((f) => f !== "credentials.json")).toEqual([]);
    expect(readCredentials(h)?.apiKey).toBe("k");
  });

  it("api-key mode stores nothing but the key", () => {
    const h = H();
    writeCredentials(h, { version: 1, source: "api-key", apiKey: "k" });
    const raw = readFileSync(credentialsPath(h), "utf8");
    expect(raw).not.toContain("issuer");
    expect(raw).not.toContain("grantId");
  });

  it("a login credential never contains a refresh token", () => {
    // Deliberately not stored. logout self-authenticates with apiKey + grantId
    // instead, because a refresh token would silently expire after 30 days and give
    // a revocation path that silently fails.
    const h = H();
    writeCredentials(h, loginCreds({}));
    expect(readFileSync(credentialsPath(h), "utf8")).not.toContain("refreshToken");
  });

  it("writes only the whitelisted login fields, even if extra properties are smuggled in", () => {
    const h = H();
    const withExtra = { ...loginCreds({}), refreshToken: "should-never-be-written" } as Credentials;
    writeCredentials(h, withExtra);
    const raw = readFileSync(credentialsPath(h), "utf8");
    expect(raw).not.toContain("should-never-be-written");
  });

  it("rejects a login credential missing required fields instead of half-reading it", () => {
    // Do not make every field optional: a bad file would be half-read and later
    // branches would silently receive undefined.
    const h = H();
    mkdirSync(join(h, ".octen"), { recursive: true });
    writeFileSync(credentialsPath(h), JSON.stringify({ version: 1, source: "login", apiKey: "k" }));
    expect(() => readCredentials(h)).toThrow(OctenValidationError);
  });

  it("rejects an unknown version and corrupt JSON loudly, without echoing file contents", () => {
    const h = H();
    mkdirSync(join(h, ".octen"), { recursive: true });

    writeFileSync(credentialsPath(h), JSON.stringify({ version: 2, source: "api-key", apiKey: "k" }));
    expect(() => readCredentials(h)).toThrow(OctenValidationError);
    // The message must point at the way out: delete the file and log in again.
    expect(() => readCredentials(h)).toThrow(/octen login/);

    const secretMarker = "SECRET_SHOULD_NOT_APPEAR_IN_ERROR";
    writeFileSync(credentialsPath(h), `{not json ${secretMarker}`);
    let corruptError: unknown;
    try {
      readCredentials(h);
    } catch (err) {
      corruptError = err;
    }
    expect(corruptError).toBeInstanceOf(OctenValidationError);
    expect(String((corruptError as Error).message)).not.toContain(secretMarker);
  });

  it("returns undefined when the file is absent", () => {
    expect(readCredentials(H())).toBeUndefined();
  });

  it("delete reports whether anything was removed", () => {
    const h = H();
    expect(deleteCredentials(h)).toBe(false);
    writeCredentials(h, { version: 1, source: "api-key", apiKey: "k" });
    expect(deleteCredentials(h)).toBe(true);
  });

  // The stored issuer is not inert data: login's step-1 cleanup and logout
  // both POST this credential's API key to it. So it has to go through the
  // same https-or-loopback rule as OCTEN_AUTH_ISSUER — otherwise a single file
  // on disk amounts to a standing instruction to mail the account-wide key
  // here, in cleartext.
  it("rejects a stored issuer that is neither https nor a loopback literal", () => {
    const h = mkdtempSync(join(tmpdir(), "octen-store-"));
    mkdirSync(join(h, ".octen"), { recursive: true });
    writeFileSync(
      join(h, ".octen", "credentials.json"),
      JSON.stringify({
        version: 1, source: "login", issuer: "http://evil.example",
        resource: "https://cli.octen.ai", apiKey: "k", apiKeyExpiresAt: null, grantId: "g",
      }),
    );
    expect(() => readCredentials(h)).toThrow(OctenValidationError);
    expect(() => readCredentials(h)).toThrow(/insecure issuer/);
  });

  it("still accepts a loopback http issuer — local development writes those", () => {
    const h = mkdtempSync(join(tmpdir(), "octen-store-"));
    mkdirSync(join(h, ".octen"), { recursive: true });
    writeFileSync(
      join(h, ".octen", "credentials.json"),
      JSON.stringify({
        version: 1, source: "login", issuer: "http://127.0.0.1:8788",
        resource: "https://cli.octen.ai", apiKey: "k", apiKeyExpiresAt: null, grantId: "g",
      }),
    );
    expect(readCredentials(h)).toMatchObject({ issuer: "http://127.0.0.1:8788" });
  });
});
