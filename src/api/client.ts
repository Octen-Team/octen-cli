import { DEFAULT_BASE_URL, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS, ENDPOINTS } from "./constants.js";
import { OctenAPIError, OctenAuthError, OctenTimeoutError } from "./errors.js";

export interface OctenClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseMs?: number;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class OctenClient {
  private apiKey: string;
  private baseUrl: string;
  private timeoutMs: number;
  private maxRetries: number;
  private retryBaseMs: number;

  constructor(opts: OctenClientOptions) {
    if (!opts.apiKey) throw new OctenAuthError("API key is required");
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBaseMs = opts.retryBaseMs ?? 500;
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
          try {
            return (await res.json()) as T;
          } catch {
            throw new OctenAPIError("API returned a 2xx response with an invalid JSON body", res.status);
          }
        }
        const rawText = await res.text().catch(() => "");
        let errBody: unknown = {};
        try { errBody = rawText ? JSON.parse(rawText) : {}; } catch { /* keep raw text */ }
        const msg = (errBody as any)?.msg ?? (errBody as any)?.error ?? (rawText ? rawText.slice(0, 500) : `HTTP ${res.status}`);
        if (RETRYABLE.has(res.status) && attempt < this.maxRetries) {
          await sleep(this.retryBaseMs * 2 ** attempt);
          continue;
        }
        if (res.status === 401) throw new OctenAuthError(msg);
        throw new OctenAPIError(msg, res.status, errBody);
      } catch (e) {
        if (e instanceof OctenAPIError || e instanceof OctenAuthError) throw e;
        if ((e as Error).name === "AbortError") throw new OctenTimeoutError("request timed out");
        lastErr = e;
        if (attempt < this.maxRetries) { await sleep(this.retryBaseMs * 2 ** attempt); continue; }
        throw lastErr;
      } finally {
        clearTimeout(t);
      }
    }
    throw lastErr;
  }

  /** Returns the raw Response for SSE streaming (chat). */
  async stream(endpoint: string, body: Record<string, unknown>, timeoutMs?: number): Promise<Response> {
    const ac = new AbortController();
    const ms = timeoutMs ?? this.timeoutMs;
    const t = ms ? setTimeout(() => ac.abort(), ms) : undefined;
    try {
      const res = await fetch(`${this.baseUrl}${endpoint}`, {
        method: "POST",
        headers: this.headers(endpoint),
        body: JSON.stringify({ ...body, stream: true }),
        signal: ac.signal,
      });
      if (!res.ok) {
        const rawText = await res.text().catch(() => "");
        let errBody: unknown = {};
        try { errBody = rawText ? JSON.parse(rawText) : {}; } catch { /* keep raw text */ }
        const msg = (errBody as any)?.msg ?? (errBody as any)?.error ?? (rawText ? rawText.slice(0, 500) : `HTTP ${res.status}`);
        throw new OctenAPIError(msg, res.status, errBody);
      }
      return res;
    } finally {
      clearTimeout(t);
    }
  }
}
