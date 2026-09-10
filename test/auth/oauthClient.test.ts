import { describe, it, expect, vi } from "vitest";
import { authorizeUrl, exchangeCode } from "../../src/auth/oauthClient.js";
import { OctenAuthError, OctenNetworkError } from "../../src/api/errors.js";

// Distinctive secret-shaped values so any test that finds them in an error
// message proves a leak — a plausible-looking prefix isn't enough, the
// literal strings below must never show up.
const SECRET_CODE = "auth-code-9f3e7c21";
const SECRET_VERIFIER = "verifier-6b1a4d90";

const args = {
  issuer: "https://auth.octen.ai",
  redirectUri: "http://127.0.0.1:5555/callback",
  code: SECRET_CODE,
  verifier: SECRET_VERIFIER,
  resource: "https://cli.octen.ai",
};

function okResponse(accessToken = "at-123"): Response {
  return new Response(JSON.stringify({ access_token: accessToken, token_type: "Bearer" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("authorizeUrl", () => {
  it("uses the fixed client_id, S256, state, resource and scope", () => {
    const u = new URL(
      authorizeUrl({
        issuer: "https://auth.octen.ai",
        redirectUri: "http://127.0.0.1:5555/callback",
        challenge: "chal",
        state: "st",
        resource: "https://cli.octen.ai",
        scope: "octen:api_key",
      }),
    );
    expect(u.pathname).toBe("/oauth/authorize");
    expect(u.searchParams.get("client_id")).toBe("octen-cli");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toBe("chal");
    expect(u.searchParams.get("state")).toBe("st");
    expect(u.searchParams.get("resource")).toBe("https://cli.octen.ai");
    expect(u.searchParams.get("scope")).toBe("octen:api_key");
  });

  it("also carries the redirect_uri the loopback server registered", () => {
    const u = new URL(
      authorizeUrl({
        issuer: "https://auth.octen.ai",
        redirectUri: "http://127.0.0.1:5555/callback",
        challenge: "chal",
        state: "st",
        resource: "https://cli.octen.ai",
        scope: "octen:api_key",
      }),
    );
    expect(u.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:5555/callback");
  });
});

describe("exchangeCode", () => {
  it("sends a form-encoded body carrying resource and the PKCE verifier", async () => {
    // token endpoint is application/x-www-form-urlencoded, not JSON.
    const fetchImpl = vi.fn().mockResolvedValue(okResponse("access-token-value"));
    const result = await exchangeCode({ ...args, fetchImpl: fetchImpl as any });

    expect(result).toEqual({ accessToken: "access-token-value" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://auth.octen.ai/api/oauth/token");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(typeof init.body).toBe("string");

    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe(SECRET_CODE);
    expect(body.get("redirect_uri")).toBe(args.redirectUri);
    expect(body.get("client_id")).toBe("octen-cli");
    expect(body.get("code_verifier")).toBe(SECRET_VERIFIER);
    expect(body.get("resource")).toBe(args.resource);
  });

  it("classifies by transport first: a 503 whose body says invalid_grant is still a network error", async () => {
    // A server fault dressed up as invalid_grant must never trigger credential deletion.
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 503 }));
    await expect(exchangeCode({ ...args, fetchImpl: fetchImpl as any })).rejects.toBeInstanceOf(
      OctenNetworkError,
    );
  });

  it("429 and 408 are network errors too", async () => {
    for (const status of [429, 408]) {
      const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status }));
      await expect(exchangeCode({ ...args, fetchImpl: fetchImpl as any })).rejects.toBeInstanceOf(
        OctenNetworkError,
      );
    }
  });

  it("a 4xx with error=invalid_grant is an auth error", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    await expect(exchangeCode({ ...args, fetchImpl: fetchImpl as any })).rejects.toBeInstanceOf(
      OctenAuthError,
    );
  });

  it("a 4xx with error=invalid_client is an auth error", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 }));
    await expect(exchangeCode({ ...args, fetchImpl: fetchImpl as any })).rejects.toBeInstanceOf(
      OctenAuthError,
    );
  });

  it("a bare 403 is an auth error even without a recognized error body", async () => {
    // audience/scope/client mismatch — retrying cannot help.
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }));
    await expect(exchangeCode({ ...args, fetchImpl: fetchImpl as any })).rejects.toBeInstanceOf(
      OctenAuthError,
    );
  });

  it("a genuine fetch rejection (DNS/timeout/connection reset) is a network error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(exchangeCode({ ...args, fetchImpl: fetchImpl as any })).rejects.toBeInstanceOf(
      OctenNetworkError,
    );
  });

  it("uses redirect:manual and treats any 3xx as an error", async () => {
    // A POST carrying the code/verifier must never be forwarded to an unintended host.
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 302, headers: { Location: "https://evil.example" } }));
    await expect(exchangeCode({ ...args, fetchImpl: fetchImpl as any })).rejects.toBeInstanceOf(
      OctenNetworkError,
    );
    expect((fetchImpl.mock.calls[0][1] as any).redirect).toBe("manual");
  });

  it("carries an AbortSignal timeout", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    await exchangeCode({ ...args, fetchImpl: fetchImpl as any });
    const init = fetchImpl.mock.calls[0][1] as any;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("never puts the code, verifier or token into an error message", async () => {
    const scenarios: Response[] = [
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 503 }),
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
      new Response("", { status: 302, headers: { Location: "https://evil.example" } }),
    ];
    for (const response of scenarios) {
      const fetchImpl = vi.fn().mockResolvedValue(response.clone());
      // The guard `throw` used to live inside the try, so it landed in
      // this very catch — and its own message contains no secret, so both
      // assertions passed. If exchangeCode had stopped rejecting entirely,
      // the test would still have been green. `threw` is asserted outside
      // the catch so a non-rejection now fails.
      let threw = false;
      try {
        await exchangeCode({ ...args, fetchImpl: fetchImpl as any });
      } catch (err) {
        threw = true;
        const message = (err as Error).message;
        expect(message).not.toContain(SECRET_CODE);
        expect(message).not.toContain(SECRET_VERIFIER);
      }
      expect(threw, `expected exchangeCode to reject for status ${response.status}`).toBe(true);
    }

    // This block's comment used to claim it checked that "the success
    // path's token never leaks into a later throw", while its only
    // assertion was `result.accessToken === "super-secret-access-token"` —
    // that the token IS returned, the opposite property. Both halves are
    // now real and named honestly.

    // (a) the happy path returns the token verbatim — nothing in the
    // redaction above mangles it.
    const okFetch = vi.fn().mockResolvedValue(okResponse("super-secret-access-token"));
    const result = await exchangeCode({ ...args, fetchImpl: okFetch as any });
    expect(result.accessToken).toBe("super-secret-access-token");

    // (b) the two 200-status error branches the scenarios loop above cannot
    // reach — a malformed body, and a body with no access_token — also
    // reject, and their messages carry no secret.
    const badBodies = [new Response("not json", { status: 200 }), okResponse("")];
    for (const body of badBodies) {
      const badFetch = vi.fn().mockResolvedValue(body);
      let threw = false;
      try {
        await exchangeCode({ ...args, fetchImpl: badFetch as any });
      } catch (err) {
        threw = true;
        const message = (err as Error).message;
        expect(message).not.toContain(SECRET_CODE);
        expect(message).not.toContain(SECRET_VERIFIER);
        expect(message).not.toContain("super-secret-access-token");
      }
      expect(threw, "expected a 200 with an unusable body to reject").toBe(true);
    }
  });
});
