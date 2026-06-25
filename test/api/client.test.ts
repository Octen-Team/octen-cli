import { describe, it, expect, vi, beforeEach } from "vitest";
import { OctenClient } from "../../src/api/client.js";
import { OctenAPIError } from "../../src/api/errors.js";

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
  });
});
