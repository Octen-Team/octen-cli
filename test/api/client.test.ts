import { describe, it, expect, vi, beforeEach } from "vitest";
import { OctenClient } from "../../src/api/client.js";
import { ENDPOINTS } from "../../src/api/constants.js";
import { OctenAPIError, OctenAuthError, OctenNetworkError, OctenTimeoutError } from "../../src/api/errors.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("OctenClient.request", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("sends x-api-key and posts JSON to the base url", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: true }));
    const c = new OctenClient({ apiKey: "k", baseUrl: "https://api.octen.ai" });
    const out = await c.request("/search", { query: "x" });
    expect(out).toEqual({ ok: true });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://api.octen.ai/search");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as any).headers["x-api-key"]).toBe("k");
    expect((init as any).headers["Authorization"]).toBeUndefined();
    expect(JSON.parse((init as any).body)).toEqual({ query: "x" });
  });

  it("retries on 503 then succeeds", async () => {
    const spy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ msg: "busy" }, 503))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const c = new OctenClient({ apiKey: "k", maxRetries: 2, retryBaseMs: 0 });
    expect(await c.request("/search", {})).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("throws OctenAPIError on non-retryable 400", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ msg: "bad param" }, 400));
    const c = new OctenClient({ apiKey: "k" });
    await expect(c.request("/search", {})).rejects.toBeInstanceOf(OctenAPIError);
  });

  it("uses Authorization Bearer for the chat endpoint", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: true }));
    const c = new OctenClient({ apiKey: "k" });
    await c.request("/v1/chat/completions", { model: "m", messages: [] });
    expect((spy.mock.calls[0][1] as any).headers["Authorization"]).toBe("Bearer k");
    expect((spy.mock.calls[0][1] as any).headers["x-api-key"]).toBeUndefined();
  });

  it("throws OctenTimeoutError on abort and does not retry", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    const c = new OctenClient({ apiKey: "k", maxRetries: 3, retryBaseMs: 0 });
    await expect(c.request("/search", {})).rejects.toBeInstanceOf(OctenTimeoutError);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("throws OctenAuthError on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ msg: "bad key" }, 401));
    const c = new OctenClient({ apiKey: "k" });
    await expect(c.request("/search", {})).rejects.toBeInstanceOf(OctenAuthError);
  });

  it("wraps a non-abort network failure as OctenNetworkError with cause + base url", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), { cause: { code: "EADDRNOTAVAIL" } }),
    );
    const c = new OctenClient({ apiKey: "k", baseUrl: "https://api.octen.ai", maxRetries: 0 });
    const err = await c.request("/search", {}).catch((e) => e);
    expect(err).toBeInstanceOf(OctenNetworkError);
    expect((err as OctenNetworkError).message).toContain("EADDRNOTAVAIL");
    expect((err as OctenNetworkError).message).toContain("https://api.octen.ai");
  });
});

describe("OctenClient.stream", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("throws OctenAPIError (status 401) when the response is not OK", async () => {
    // stream() does not special-case 401 into OctenAuthError (unlike request()),
    // so a non-OK 401 surfaces as an OctenAPIError carrying status 401.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ msg: "bad key" }, 401));
    const c = new OctenClient({ apiKey: "k" });
    await expect(
      c.stream(ENDPOINTS.chat, { model: "m", messages: [] }),
    ).rejects.toBeInstanceOf(OctenAPIError);

    // Re-run to inspect the thrown error's status field.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ msg: "bad key" }, 401));
    const c2 = new OctenClient({ apiKey: "k" });
    const err = await c2
      .stream(ENDPOINTS.chat, { model: "m", messages: [] })
      .catch((e) => e);
    expect(err).toBeInstanceOf(OctenAPIError);
    expect((err as OctenAPIError).status).toBe(401);
  });
});
