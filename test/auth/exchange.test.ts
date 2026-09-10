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
    expect(r.grantId).toBe("g-1"); // logout and whoami both depend on this
    expect(r.accountId).toBe("u-1");
    expect(r.accountType).toBe("user");

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://auth.octen.ai/api/oauth/cli/key");
    expect((init as any).method).toBe("POST");
    expect((init as any).headers.Authorization).toBe("Bearer at");
  });

  // `account_name` is the display name for the login confirmation line. It is
  // optional on the wire in both directions: a server older than the field
  // omits it, and so does a current server that could not load the name. Every
  // unusable shape must collapse to `undefined` so the caller falls back to
  // the account id — an empty or blank string reaching the message would print
  // "Logged in as ." and read like a bug.
  it.each([
    ["a usable name", "Octen family", "Octen family"],
    ["an absent field", undefined, undefined],
    ["an empty string", "", undefined],
    ["a blank string", "   ", undefined],
    ["a non-string", 42, undefined],
    ["null", null, undefined],
  ])("account_name: %s", async (_label, wire, expected) => {
    const body: Record<string, unknown> = {
      active: true,
      api_key: "user-real-key",
      expires_at: null,
      grant_id: "g-1",
      account_type: "organization",
      account_id: "org-1",
    };
    if (wire !== undefined) body.account_name = wire;

    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const r = await exchangeForApiKey({
      issuer: "https://auth.octen.ai",
      accessToken: "at",
      fetchImpl: fetchImpl as any,
    });

    expect(r.accountName).toBe(expected);
    // A missing name must never cost the caller the key itself.
    expect(r.apiKey).toBe("user-real-key");
    expect(r.accountId).toBe("org-1");
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
    // Forward compatibility: once the server starts minting short-lived
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

  // These two are the core invariant of the whole flow. Deleting in the
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

  it("a 200 response with a missing or empty grant_id is a contract violation", async () => {
    // grantId is what logout/whoami depend on — a 200 body lacking it is
    // the same class of contract violation as a missing api_key, and must
    // not be silently absorbed into `grantId: undefined` cast as a string.
    for (const body of [
      { active: true, api_key: "k", expires_at: null }, // grant_id missing entirely
      { active: true, api_key: "k", expires_at: null, grant_id: "" }, // grant_id empty
    ]) {
      const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
      await expect(
        exchangeForApiKey({ issuer: "https://auth.octen.ai", accessToken: "at", fetchImpl: fetchImpl as any }),
      ).rejects.toBeInstanceOf(OctenNetworkError);
    }
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
      // The guard `throw` used to live inside the try, so it landed in
      // this very catch — and its own message contains no secret, so both
      // assertions passed even if exchangeForApiKey had stopped rejecting.
      // `threw` is asserted outside the catch so that can no longer pass.
      let threw = false;
      try {
        await exchangeForApiKey({
          issuer: "https://auth.octen.ai",
          accessToken: SECRET_TOKEN,
          fetchImpl: fetchImpl as any,
        });
      } catch (err) {
        threw = true;
        const message = (err as Error).message;
        expect(message).not.toContain(SECRET_TOKEN);
        expect(message).not.toContain(SECRET_API_KEY);
      }
      expect(threw, `expected exchangeForApiKey to reject for status ${response.status}`).toBe(true);
    }

    // This block's comment used to claim it checked that "the success
    // path's key never leaks into a subsequent throw", while its only
    // assertion was `result.apiKey === SECRET_API_KEY` — that the key IS
    // returned, the opposite property. Both halves are now real and named
    // honestly.

    // (a) the happy path returns the key verbatim.
    const okFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ active: true, api_key: SECRET_API_KEY, expires_at: null, grant_id: "g-1" }),
        { status: 200 },
      ),
    );
    const result = await exchangeForApiKey({
      issuer: "https://auth.octen.ai",
      accessToken: SECRET_TOKEN,
      fetchImpl: okFetch as any,
    });
    expect(result.apiKey).toBe(SECRET_API_KEY);

    // (b) the 200-status error branches the scenarios loop above cannot
    // reach — `active: false`, and a 200 body that still carries the key
    // but is otherwise unusable — reject with no secret in the message.
    const badBodies: Response[] = [
      new Response(JSON.stringify({ active: false }), { status: 200 }),
      new Response(
        JSON.stringify({ active: true, api_key: SECRET_API_KEY, expires_at: null }),
        { status: 200 },
      ),
    ];
    for (const body of badBodies) {
      const badFetch = vi.fn().mockResolvedValue(body);
      let threw = false;
      try {
        await exchangeForApiKey({
          issuer: "https://auth.octen.ai",
          accessToken: SECRET_TOKEN,
          fetchImpl: badFetch as any,
        });
      } catch (err) {
        threw = true;
        const message = (err as Error).message;
        expect(message).not.toContain(SECRET_TOKEN);
        expect(message).not.toContain(SECRET_API_KEY);
      }
      expect(threw, "expected a 200 with an unusable body to reject").toBe(true);
    }
  });
});
