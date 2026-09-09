import { describe, it, expect, vi } from "vitest";
import { exchangeForApiKey } from "../../src/auth/exchange.js";
import { OctenAuthError, OctenNetworkError } from "../../src/api/errors.js";

// Distinctive secret-shaped values so any test that finds them in an error
// message proves a leak — a plausible-looking prefix isn't enough, the
// literal strings below must never show up.
const SECRET_TOKEN = "access-token-9f3e7c21";
const SECRET_API_KEY = "api-key-6b1a4d90";

describe("exchangeForApiKey", () => {
  it("returns the resolved key and a null expiry", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          active: true,
          api_key: "user-real-key",
          expires_at: null,
          grant_id: "g-1",
          account_type: "user",
          account_id: "u-1",
        }),
        { status: 200 },
      ),
    );

    const r = await exchangeForApiKey({
      issuer: "https://auth.octen.ai",
      accessToken: "at",
      fetchImpl: fetchImpl as any,
    });
    expect(r.apiKey).toBe("user-real-key");
    expect(r.expiresAt).toBeNull();
    expect(r.grantId).toBe("g-1"); // F11
    expect(r.accountId).toBe("u-1");
    expect(r.accountType).toBe("user");

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://auth.octen.ai/api/oauth/cli/key");
    expect((init as any).method).toBe("POST");
    expect((init as any).headers.Authorization).toBe("Bearer at");
  });

  it("sends no request body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ active: true, api_key: "k", expires_at: null, grant_id: "g-1" }),
        { status: 200 },
      ),
    );
    await exchangeForApiKey({ issuer: "https://auth.octen.ai", accessToken: "at", fetchImpl: fetchImpl as any });
    const init = fetchImpl.mock.calls[0][1] as any;
    expect(init.body).toBeUndefined();
  });

  it("carries an AbortSignal timeout", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ active: true, api_key: "k", expires_at: null, grant_id: "g-1" }),
        { status: 200 },
      ),
    );
    await exchangeForApiKey({ issuer: "https://auth.octen.ai", accessToken: "at", fetchImpl: fetchImpl as any });
    const init = fetchImpl.mock.calls[0][1] as any;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses redirect:manual and treats any 3xx as an error", async () => {
    // A request carrying a bearer token must never be forwarded to an unintended host.
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 302, headers: { Location: "https://evil.example" } }));
    await expect(
      exchangeForApiKey({ issuer: "https://auth.octen.ai", accessToken: "at", fetchImpl: fetchImpl as any }),
    ).rejects.toBeInstanceOf(OctenNetworkError);
    expect((fetchImpl.mock.calls[0][1] as any).redirect).toBe("manual");
  });

  it("parses a non-null expires_at when the server starts sending one", async () => {
    // F8's forward compatibility: once the server starts minting short-lived
    // keys, the CLI can already store an expiry.
    const iso = "2026-09-07T12:00:00Z";
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ active: true, api_key: "k", expires_at: iso, grant_id: "g-1" }), {
        status: 200,
      }),
    );
    const r = await exchangeForApiKey({
      issuer: "https://auth.octen.ai",
      accessToken: "at",
      fetchImpl: fetchImpl as any,
    });
    expect(r.expiresAt).toBe(Math.floor(Date.parse(iso) / 1000));
  });

  // These two are the core invariant of the whole design. Deleting in the
  // wrong direction is asymmetric: treating a retryable fault as a credential
  // problem sends users round a re-login loop that cannot fix anything.
  it("401 and active:false are credential problems", async () => {
    for (const res of [
      new Response("", { status: 401 }),
      new Response(JSON.stringify({ active: false }), { status: 200 }),
    ]) {
      const fetchImpl = vi.fn().mockResolvedValue(res);
      await expect(
        exchangeForApiKey({ issuer: "https://auth.octen.ai", accessToken: "at", fetchImpl: fetchImpl as any }),
      ).rejects.toBeInstanceOf(OctenAuthError);
    }
  });

  it("403 is a credential problem too — audience/scope/client mismatch, retrying will not help", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 403 }));
    await expect(
      exchangeForApiKey({ issuer: "https://auth.octen.ai", accessToken: "at", fetchImpl: fetchImpl as any }),
    ).rejects.toBeInstanceOf(OctenAuthError);
  });

  it("503 is a retryable backend problem, never a credential problem", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    const err = await exchangeForApiKey({
      issuer: "https://auth.octen.ai",
      accessToken: "at",
      fetchImpl: fetchImpl as any,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(OctenNetworkError);
    expect(String(err.message)).toMatch(/重试|retry/i);
  });

  it("429 and 408 are network errors too", async () => {
    for (const status of [429, 408]) {
      const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status }));
      await expect(
        exchangeForApiKey({ issuer: "https://auth.octen.ai", accessToken: "at", fetchImpl: fetchImpl as any }),
      ).rejects.toBeInstanceOf(OctenNetworkError);
    }
  });

  it("a 503 whose body claims active:false is still a network error, not a credential problem", async () => {
    // Classify by transport layer first: a server fault dressed up as a
    // credential problem must never trigger credential deletion downstream.
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ active: false }), { status: 503 }));
    await expect(
      exchangeForApiKey({ issuer: "https://auth.octen.ai", accessToken: "at", fetchImpl: fetchImpl as any }),
    ).rejects.toBeInstanceOf(OctenNetworkError);
  });

  it("a genuine fetch rejection (DNS/timeout/connection reset) is a network error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      exchangeForApiKey({ issuer: "https://auth.octen.ai", accessToken: "at", fetchImpl: fetchImpl as any }),
    ).rejects.toBeInstanceOf(OctenNetworkError);
  });

  it("an unparsable expires_at is a contract violation, not silently ignored", async () => {
    // Reports OctenNetworkError; never silently falls back to local time.
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ active: true, api_key: "k", expires_at: "not-a-date", grant_id: "g-1" }),
        { status: 200 },
      ),
    );
    await expect(
      exchangeForApiKey({ issuer: "https://auth.octen.ai", accessToken: "at", fetchImpl: fetchImpl as any }),
    ).rejects.toBeInstanceOf(OctenNetworkError);
  });

  it("a 200 response with no api_key is a contract violation", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ active: true, expires_at: null, grant_id: "g-1" }), { status: 200 }),
    );
    await expect(
      exchangeForApiKey({ issuer: "https://auth.octen.ai", accessToken: "at", fetchImpl: fetchImpl as any }),
    ).rejects.toBeInstanceOf(OctenNetworkError);
  });

  it("never puts the access token or the api key into an error message", async () => {
    const scenarios: Response[] = [
      new Response("", { status: 401 }),
      new Response("", { status: 403 }),
      new Response("", { status: 503 }),
      new Response("", { status: 302, headers: { Location: "https://evil.example" } }),
    ];
    for (const response of scenarios) {
      const fetchImpl = vi.fn().mockResolvedValue(response.clone());
      try {
        await exchangeForApiKey({
          issuer: "https://auth.octen.ai",
          accessToken: SECRET_TOKEN,
          fetchImpl: fetchImpl as any,
        });
        throw new Error("expected exchangeForApiKey to reject");
      } catch (err) {
        const message = (err as Error).message;
        expect(message).not.toContain(SECRET_TOKEN);
        expect(message).not.toContain(SECRET_API_KEY);
      }
    }

    // Also check the success path's key never leaks into a subsequent unrelated throw path.
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ active: true, api_key: SECRET_API_KEY, expires_at: null, grant_id: "g-1" }),
        { status: 200 },
      ),
    );
    const result = await exchangeForApiKey({
      issuer: "https://auth.octen.ai",
      accessToken: SECRET_TOKEN,
      fetchImpl: fetchImpl as any,
    });
    expect(result.apiKey).toBe(SECRET_API_KEY);
  });
});
