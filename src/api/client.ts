import { DEFAULT_BASE_URL, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS, ENDPOINTS } from "./constants.js";
import {
  errorMessage,
  OctenAPIError,
  OctenAuthError,
  OctenNetworkError,
  OctenTimeoutError,
} from "./errors.js";

export interface OctenClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  /** Upper bound on a single retry wait, including one asked for by Retry-After. */
  retryMaxDelayMs?: number;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MALFORMED_SUCCESS = "API returned a 2xx response with an empty or invalid JSON body";
/** Cap on one retry wait. Mirrors the Python SDK's max_delay. */
const DEFAULT_RETRY_MAX_DELAY_MS = 30_000;
/** A bare integer Retry-After — anything else is a date or invalid. */
const DELTA_SECONDS = /^[+-]?\d+$/;

/**
 * RFC 9110 Retry-After: either non-negative delta-seconds or an HTTP-date.
 * Returns milliseconds to wait, or null when the header cannot be trusted (a
 * negative delta, a malformed date, junk) so the caller keeps its own backoff.
 */
function parseRetryAfter(header: string, nowMs: number): number | null {
  const value = header.trim();
  if (!value) return null;
  if (DELTA_SECONDS.test(value)) {
    const seconds = Number(value);
    return seconds >= 0 ? seconds * 1000 : null;
  }
  const when = Date.parse(value);
  if (Number.isNaN(when)) return null;
  return Math.max(0, when - nowMs);
}

/**
 * Read the message out of a non-2xx body. Structured JSON wins; an unparseable
 * body keeps up to 500 characters of its own text, which is often the only
 * diagnostic an upstream gateway gives us; otherwise the HTTP status.
 */
function httpErrorMessage(payload: unknown, rawText: string, status: number): string {
  if (payload !== undefined) {
    const fromJson = errorMessage(payload, "");
    if (fromJson) return fromJson;
    return `HTTP ${status}`;
  }
  const text = rawText.trim();
  return text ? text.slice(0, 500) : `HTTP ${status}`;
}

export class OctenClient {
  private apiKey: string;
  private baseUrl: string;
  private timeoutMs: number;
  private maxRetries: number;
  private retryBaseMs: number;
  private retryMaxDelayMs: number;

  constructor(opts: OctenClientOptions) {
    if (!opts.apiKey) throw new OctenAuthError("API key is required");
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBaseMs = opts.retryBaseMs ?? 500;
    this.retryMaxDelayMs = opts.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
  }

  /**
   * How long to wait before the next attempt. A valid `Retry-After` (either
   * delta-seconds or an HTTP-date) wins over the exponential backoff, but is
   * capped: a server asking for an hour must not turn one command into an
   * hour-long hang.
   */
  private retryDelayMs(response: Response, attempt: number, nowMs = Date.now()): number {
    const backoff = this.retryBaseMs * 2 ** attempt;
    const header = response.headers.get("retry-after");
    const asked = header == null ? null : parseRetryAfter(header, nowMs);
    const delay = asked ?? backoff;
    return Math.min(delay, this.retryMaxDelayMs);
  }

  /**
   * A 2xx body must be a non-empty JSON object, and an Octen envelope carrying a
   * non-zero numeric `code` is a failure however cheerful its HTTP status was.
   * A string or null `code` is left to the endpoint's own response shape.
   */
  private validateSuccessPayload(payload: unknown, status: number): Record<string, unknown> {
    if (payload === null || Array.isArray(payload) || typeof payload !== "object") {
      throw new OctenAPIError(MALFORMED_SUCCESS, status, payload);
    }
    const obj = payload as Record<string, unknown>;
    if (Object.keys(obj).length === 0) {
      throw new OctenAPIError(MALFORMED_SUCCESS, status, payload);
    }
    const code = obj.code;
    if (typeof code === "number" && code !== 0) {
      throw new OctenAPIError(errorMessage(obj, `API returned code ${code}`), status, payload);
    }
    return obj;
  }

  private headers(endpoint: string): Record<string, string> {
    // Chat uses the OpenAI-compatible /v1/chat/completions surface (Authorization: Bearer); native Octen endpoints use x-api-key.
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (endpoint === ENDPOINTS.chat) h["Authorization"] = `Bearer ${this.apiKey}`;
    else h["x-api-key"] = this.apiKey;
    return h;
  }

  async request<T = unknown>(endpoint: string, body: unknown, timeoutMs?: number): Promise<T> {
    // Retry policy: retry only on 429/5xx with exponential backoff; 4xx (except 429) and timeouts are NOT retried; the timeout is per-attempt, not total.
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeoutMs ?? this.timeoutMs);
      try {
        const res = await fetch(`${this.baseUrl}${endpoint}`, {
          method: "POST",
          headers: this.headers(endpoint),
          body: JSON.stringify(body),
          signal: ac.signal,
        });
        if (res.ok) {
          let payload: unknown;
          try {
            payload = await res.json();
          } catch {
            throw new OctenAPIError(MALFORMED_SUCCESS, res.status);
          }
          return this.validateSuccessPayload(payload, res.status) as T;
        }
        const rawText = await res.text().catch(() => "");
        let errBody: unknown = undefined;
        try { errBody = rawText ? JSON.parse(rawText) : undefined; } catch { /* keep raw text */ }
        const msg = httpErrorMessage(errBody, rawText, res.status);
        if (RETRYABLE.has(res.status) && attempt < this.maxRetries) {
          await sleep(this.retryDelayMs(res, attempt));
          continue;
        }
        if (res.status === 401) throw new OctenAuthError(msg);
        throw new OctenAPIError(msg, res.status, errBody);
      } catch (e) {
        if (e instanceof OctenAPIError || e instanceof OctenAuthError) throw e;
        if ((e as Error).name === "AbortError") throw new OctenTimeoutError("request timed out");
        lastErr = e;
        if (attempt < this.maxRetries) { await sleep(this.retryBaseMs * 2 ** attempt); continue; }
        // Out of retries on a non-Octen, non-abort error: surface the underlying network cause.
        const cause = (e as any)?.cause?.code ?? (e as any)?.cause?.message ?? (e as Error).message;
        throw new OctenNetworkError(`network error reaching ${this.baseUrl}: ${cause}`);
      } finally {
        clearTimeout(t);
      }
    }
    throw lastErr;
  }

  /**
   * Returns the Response for SSE streaming (chat).
   *
   * The timeout covers the whole request, not just the headers: it is armed
   * while we wait for the next chunk and disarmed once that chunk lands, so a
   * server that stops sending mid-answer aborts the request while a long answer
   * that keeps streaming does not. That is the same per-read deadline httpx
   * gives the Python SDK, so both clients promise the same thing.
   */
  async stream(endpoint: string, body: Record<string, unknown>, timeoutMs?: number): Promise<Response> {
    const ac = new AbortController();
    const ms = timeoutMs ?? this.timeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (!ms) return;
      clearTimeout(timer);
      timer = setTimeout(() => ac.abort(), ms);
    };
    const disarm = () => {
      clearTimeout(timer);
      timer = undefined;
    };

    arm();
    try {
      const res = await fetch(`${this.baseUrl}${endpoint}`, {
        method: "POST",
        headers: this.headers(endpoint),
        body: JSON.stringify({ ...body, stream: true }),
        signal: ac.signal,
      });
      disarm();
      if (!res.ok) {
        const rawText = await res.text().catch(() => "");
        let errBody: unknown = undefined;
        try { errBody = rawText ? JSON.parse(rawText) : undefined; } catch { /* keep raw text */ }
        throw new OctenAPIError(
          httpErrorMessage(errBody, rawText, res.status),
          res.status,
          errBody,
        );
      }
      if (!ms || !res.body) return res;

      // Wrap the body so the deadline keeps applying to each chunk. The source
      // reader is released on end, error and consumer cancellation alike.
      const source = res.body.getReader();
      const wrapped = new ReadableStream<Uint8Array>({
        async pull(controller) {
          arm();
          try {
            const { done, value } = await source.read();
            disarm();
            if (done) {
              controller.close();
              return;
            }
            controller.enqueue(value);
          } catch (err) {
            disarm();
            controller.error(err);
          }
        },
        async cancel(reason) {
          disarm();
          try {
            await source.cancel(reason);
          } catch {
            /* the stream is already gone */
          }
        },
      });

      return new Response(wrapped, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    } catch (e) {
      disarm();
      if (e instanceof OctenAPIError || e instanceof OctenAuthError) throw e;
      if ((e as Error).name === "AbortError") throw new OctenTimeoutError("request timed out");
      const cause = (e as any)?.cause?.code ?? (e as any)?.cause?.message ?? (e as Error).message;
      throw new OctenNetworkError(`network error reaching ${this.baseUrl}: ${cause}`);
    }
  }
}
