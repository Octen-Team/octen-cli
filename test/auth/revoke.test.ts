import { describe, it, expect, vi } from "vitest";
import { revokeCliGrant, GRANT_ALREADY_GONE_MESSAGE } from "../../src/auth/revoke.js";
import { OctenAuthError, OctenNetworkError } from "../../src/api/errors.js";

// Distinctive secret-shaped values so any test that finds them in an error
// message proves a leak.
const SECRET_API_KEY = "api-key-6b1a4d90";
const SECRET_GRANT_ID = "secret-grant-id-9f3e7c21";

describe("revokeCliGrant", () => {
  it("posts x-api-key auth and {grant_id} body to /api/oauth/cli/revoke", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await revokeCliGrant({
      issuer: "https://auth.octen.ai",
      apiKey: SECRET_API_KEY,
      grantId: "grant-1",
      fetchImpl: fetchImpl as any,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://auth.octen.ai/api/oauth/cli/revoke");
    expect((init as any).method).toBe("POST");
    expect((init as any).headers["x-api-key"]).toBe(SECRET_API_KEY);
    expect(JSON.parse((init as any).body)).toEqual({ grant_id: "grant-1" });
  });

  it("treats an already-revoked grant (200) as success — idempotent", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await expect(
      revokeCliGrant({ issuer: "https://auth.octen.ai", apiKey: "k", grantId: "g", fetchImpl: fetchImpl as any }),
    ).resolves.toBeUndefined();
  });

  it("401 (key missing/unknown/inactive) -> OctenAuthError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(
      revokeCliGrant({ issuer: "https://auth.octen.ai", apiKey: "k", grantId: "g", fetchImpl: fetchImpl as any }),
    ).rejects.toBeInstanceOf(OctenAuthError);
  });

  it("403 (grant not bound to that key / not a CLI grant) -> OctenAuthError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 403 }));
    await expect(
      revokeCliGrant({ issuer: "https://auth.octen.ai", apiKey: "k", grantId: "g", fetchImpl: fetchImpl as any }),
    ).rejects.toBeInstanceOf(OctenAuthError);
  });

  it("400 (unknown/malformed grant_id) -> OctenAuthError carrying GRANT_ALREADY_GONE_MESSAGE", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 400 }));
    let thrown: unknown;
    await revokeCliGrant({
      issuer: "https://auth.octen.ai",
      apiKey: "k",
      grantId: "g",
      fetchImpl: fetchImpl as any,
    }).catch((err) => {
      thrown = err;
    });
    expect(thrown).toBeInstanceOf(OctenAuthError);
    // F10: `octen logout` selects its "already gone" copy on this exact
    // message. It now imports this constant instead of re-typing the
    // sentence, so the two can no longer drift silently — this assertion
    // pins the 400 branch to the constant from revoke.ts's own side.
    expect((thrown as Error).message).toBe(GRANT_ALREADY_GONE_MESSAGE);
  });

  it("503 (infrastructure failure) -> OctenNetworkError", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 503, headers: { "retry-after": "5" } }));
    await expect(
      revokeCliGrant({ issuer: "https://auth.octen.ai", apiKey: "k", grantId: "g", fetchImpl: fetchImpl as any }),
    ).rejects.toBeInstanceOf(OctenNetworkError);
  });

  it("a transport-level failure -> OctenNetworkError", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    await expect(
      revokeCliGrant({ issuer: "https://auth.octen.ai", apiKey: "k", grantId: "g", fetchImpl: fetchImpl as any }),
    ).rejects.toBeInstanceOf(OctenNetworkError);
  });

  it("never echoes the api key or grant id in its error message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(
      revokeCliGrant({
        issuer: "https://auth.octen.ai",
        apiKey: SECRET_API_KEY,
        grantId: SECRET_GRANT_ID,
        fetchImpl: fetchImpl as any,
      }),
    ).rejects.toSatisfy((err: unknown) => {
      const message = (err as Error).message;
      expect(message).not.toContain(SECRET_API_KEY);
      expect(message).not.toContain(SECRET_GRANT_ID);
      return true;
    });
  });

  it("carries an AbortSignal timeout and never follows a redirect", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await revokeCliGrant({ issuer: "https://auth.octen.ai", apiKey: "k", grantId: "g", fetchImpl: fetchImpl as any });
    const init = fetchImpl.mock.calls[0][1] as any;
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("a redirect response is treated as a network fault, not followed", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://evil.example/" } }));
    await expect(
      revokeCliGrant({ issuer: "https://auth.octen.ai", apiKey: "k", grantId: "g", fetchImpl: fetchImpl as any }),
    ).rejects.toBeInstanceOf(OctenNetworkError);
  });
});
