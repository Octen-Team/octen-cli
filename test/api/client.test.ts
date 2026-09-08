import { describe, it, expect, vi, beforeEach } from "vitest";
import { OctenClient } from "../../src/api/client.js";
import { parseSSE } from "../../src/api/sse.js";
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

function textResponse(body: string, status: number, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers: { "content-type": "text/plain", ...headers } });
}

describe("OctenClient error message extraction", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("reads a nested structured error instead of printing [object Object]", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: { message: "detail" } }, 400),
    );
    const c = new OctenClient({ apiKey: "k" });
    await expect(c.request("/search", {})).rejects.toMatchObject({ message: "detail" });
  });

  it("prefers msg over message and detail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ msg: "from msg", message: "from message", detail: "from detail" }, 400),
    );
    const c = new OctenClient({ apiKey: "k" });
    await expect(c.request("/search", {})).rejects.toMatchObject({ message: "from msg" });
  });

  it("falls back to detail when msg and message are absent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ detail: "from detail" }, 422),
    );
    const c = new OctenClient({ apiKey: "k" });
    await expect(c.request("/search", {})).rejects.toMatchObject({ message: "from detail" });
  });

  it("keeps a plain-text error body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      textResponse("upstream gateway exploded", 502),
    );
    const c = new OctenClient({ apiKey: "k", maxRetries: 0 });
    await expect(c.request("/search", {})).rejects.toMatchObject({
      message: "upstream gateway exploded",
    });
  });

  it("falls back to the HTTP status when the body is empty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(textResponse("", 418));
    const c = new OctenClient({ apiKey: "k" });
    await expect(c.request("/search", {})).rejects.toMatchObject({ message: "HTTP 418" });
  });
});

describe("OctenClient 2xx response contract", () => {
  beforeEach(() => vi.restoreAllMocks());

  const MALFORMED = "API returned a 2xx response with an empty or invalid JSON body";

  it("rejects a 200 null body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(null));
    const c = new OctenClient({ apiKey: "k" });
    await expect(c.request("/search", {})).rejects.toThrow(MALFORMED);
  });

  it("rejects a 200 empty object", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}));
    const c = new OctenClient({ apiKey: "k" });
    await expect(c.request("/search", {})).rejects.toThrow(MALFORMED);
  });

  it("rejects a 200 array body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([{ a: 1 }]));
    const c = new OctenClient({ apiKey: "k" });
    await expect(c.request("/search", {})).rejects.toThrow(MALFORMED);
  });

  it("rejects a 200 primitive body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(7));
    const c = new OctenClient({ apiKey: "k" });
    await expect(c.request("/search", {})).rejects.toThrow(MALFORMED);
  });

  it("treats a 200 with a non-zero numeric code as a failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ code: 7, msg: "application failure" }),
    );
    const c = new OctenClient({ apiKey: "k" });
    await expect(c.request("/search", {})).rejects.toMatchObject({
      message: "application failure",
      status: 200,
    });
  });

  it("names the code when a non-zero envelope carries no message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ code: 7 }));
    const c = new OctenClient({ apiKey: "k" });
    await expect(c.request("/search", {})).rejects.toThrow("API returned code 7");
  });

  it("accepts a 200 with code 0", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ code: 0, data: { a: 1 } }));
    const c = new OctenClient({ apiKey: "k" });
    await expect(c.request("/search", {})).resolves.toEqual({ code: 0, data: { a: 1 } });
  });

  it("leaves a string code to the endpoint response shape", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ code: "7", data: {} }));
    const c = new OctenClient({ apiKey: "k" });
    await expect(c.request("/search", {})).resolves.toEqual({ code: "7", data: {} });
  });

  it("accepts an OpenAI-compatible chat body that carries no code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: "hi" } }] }),
    );
    const c = new OctenClient({ apiKey: "k" });
    await expect(c.request(ENDPOINTS.chat, {})).resolves.toMatchObject({
      choices: [{ message: { content: "hi" } }],
    });
  });
});

describe("OctenClient Retry-After handling", () => {
  beforeEach(() => vi.restoreAllMocks());

  function rateLimited(headers: Record<string, string>) {
    return new Response(JSON.stringify({ msg: "slow down" }), {
      status: 429,
      headers: { "content-type": "application/json", ...headers },
    });
  }

  it("waits the delta-seconds a 429 asks for", async () => {
    vi.useFakeTimers();
    try {
      const spy = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(rateLimited({ "retry-after": "2" }))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));
      const c = new OctenClient({ apiKey: "k", maxRetries: 1, retryBaseMs: 500 });
      const pending = c.request("/search", {});

      await vi.advanceTimersByTimeAsync(1999);
      expect(spy).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(spy).toHaveBeenCalledTimes(2);
      await expect(pending).resolves.toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits until the HTTP-date a 429 asks for", async () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-09-08T00:00:00.000Z");
      vi.setSystemTime(now);
      const when = new Date(now.getTime() + 3000).toUTCString();

      const spy = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(rateLimited({ "retry-after": when }))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));
      const c = new OctenClient({ apiKey: "k", maxRetries: 1, retryBaseMs: 500 });
      const pending = c.request("/search", {});

      await vi.advanceTimersByTimeAsync(2999);
      expect(spy).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(spy).toHaveBeenCalledTimes(2);
      await expect(pending).resolves.toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the exponential backoff when Retry-After is not parseable", async () => {
    vi.useFakeTimers();
    try {
      const spy = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(rateLimited({ "retry-after": "whenever" }))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));
      const c = new OctenClient({ apiKey: "k", maxRetries: 1, retryBaseMs: 500 });
      const pending = c.request("/search", {});

      await vi.advanceTimersByTimeAsync(499);
      expect(spy).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(spy).toHaveBeenCalledTimes(2);
      await expect(pending).resolves.toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a negative Retry-After and uses the exponential backoff", async () => {
    vi.useFakeTimers();
    try {
      const spy = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(rateLimited({ "retry-after": "-5" }))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));
      const c = new OctenClient({ apiKey: "k", maxRetries: 1, retryBaseMs: 500 });
      const pending = c.request("/search", {});

      await vi.advanceTimersByTimeAsync(500);
      expect(spy).toHaveBeenCalledTimes(2);
      await expect(pending).resolves.toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps a very long Retry-After so the CLI cannot hang for an hour", async () => {
    vi.useFakeTimers();
    try {
      const spy = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(rateLimited({ "retry-after": "3600" }))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));
      const c = new OctenClient({
        apiKey: "k",
        maxRetries: 1,
        retryBaseMs: 500,
        retryMaxDelayMs: 30_000,
      });
      const pending = c.request("/search", {});

      await vi.advanceTimersByTimeAsync(29_999);
      expect(spy).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(spy).toHaveBeenCalledTimes(2);
      await expect(pending).resolves.toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("honours Retry-After on a 503 as well", async () => {
    vi.useFakeTimers();
    try {
      const spy = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response("busy", { status: 503, headers: { "retry-after": "1" } }),
        )
        .mockResolvedValueOnce(jsonResponse({ ok: true }));
      const c = new OctenClient({ apiKey: "k", maxRetries: 1, retryBaseMs: 500 });
      const pending = c.request("/search", {});

      await vi.advanceTimersByTimeAsync(999);
      expect(spy).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(spy).toHaveBeenCalledTimes(2);
      await expect(pending).resolves.toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("OctenClient.stream body deadline", () => {
  beforeEach(() => vi.restoreAllMocks());

  /**
   * A response whose body behaves like fetch's: it errors with an AbortError
   * when the request signal aborts, and only carries what the test pushes.
   */
  function abortableBody(init: RequestInit | undefined) {
    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        init?.signal?.addEventListener("abort", () => {
          try {
            controller.error(Object.assign(new Error("aborted"), { name: "AbortError" }));
          } catch {
            /* already closed */
          }
        });
      },
    });
    return {
      response: new Response(body, { status: 200 }),
      push: (text: string) => controller.enqueue(encoder.encode(text)),
    };
  }

  it("raises OctenTimeoutError when the body stalls after the headers arrive", async () => {
    vi.useFakeTimers();
    try {
      let feed!: ReturnType<typeof abortableBody>;
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
        feed = abortableBody(init as RequestInit);
        return feed.response;
      });

      const c = new OctenClient({ apiKey: "k", timeoutMs: 100 });
      const res = await c.stream(ENDPOINTS.chat, { model: "m", messages: [] });

      const iterator = parseSSE(res);
      const pending = iterator.next();
      await vi.advanceTimersByTimeAsync(100);

      await expect(pending).rejects.toBeInstanceOf(OctenTimeoutError);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not time out a long stream that keeps delivering chunks", async () => {
    vi.useFakeTimers();
    try {
      let feed!: ReturnType<typeof abortableBody>;
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
        feed = abortableBody(init as RequestInit);
        return feed.response;
      });

      const c = new OctenClient({ apiKey: "k", timeoutMs: 100 });
      const res = await c.stream(ENDPOINTS.chat, { model: "m", messages: [] });
      const iterator = parseSSE(res);

      // Three gaps of 99ms each: 297ms total, well past the 100ms deadline, but
      // no single gap reaches it. The deadline is per-read, like the SDK's.
      const first = iterator.next();
      await vi.advanceTimersByTimeAsync(99);
      feed.push('data: {"type":"content"}\n\n');
      expect((await first).value).toMatchObject({ type: "content" });

      const second = iterator.next();
      await vi.advanceTimersByTimeAsync(99);
      feed.push('data: {"type":"content"}\n\n');
      expect((await second).value).toMatchObject({ type: "content" });

      const third = iterator.next();
      await vi.advanceTimersByTimeAsync(99);
      feed.push("data: [DONE]\n\n");
      expect((await third).done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves status, statusText and headers on the wrapped response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('data: [DONE]\n\n', {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "text/event-stream", "x-request-id": "abc123" },
      }),
    );
    const c = new OctenClient({ apiKey: "k", timeoutMs: 1000 });
    const res = await c.stream(ENDPOINTS.chat, { model: "m", messages: [] });

    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe("abc123");
    expect(res.headers.get("content-type")).toBe("text/event-stream");
  });

  it("cancels the upstream body when the consumer stops early", async () => {
    let cancelled = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"type":"content"}\n\n'));
        },
        cancel() {
          cancelled = true;
        },
      });
      return new Response(body, { status: 200 });
    });

    const c = new OctenClient({ apiKey: "k", timeoutMs: 1000 });
    const res = await c.stream(ENDPOINTS.chat, { model: "m", messages: [] });
    const iterator = parseSSE(res);
    await iterator.next();
    await iterator.return(undefined);

    expect(cancelled).toBe(true);
  });
});
