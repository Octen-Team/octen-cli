import { DEFAULT_BASE_URL, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS, ENDPOINTS } from "./constants.js";
import { OctenAPIError, OctenTimeoutError } from "./errors.js";

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
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBaseMs = opts.retryBaseMs ?? 500;
  }

  private headers(endpoint: string): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (endpoint === ENDPOINTS.chat) h["Authorization"] = `Bearer ${this.apiKey}`;
    else h["x-api-key"] = this.apiKey;
    return h;
  }

  async request<T = unknown>(endpoint: string, body: unknown, timeoutMs?: number): Promise<T> {
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
        if (res.ok) return (await res.json()) as T;
        const errBody = await res.json().catch(() => ({}));
        if (RETRYABLE.has(res.status) && attempt < this.maxRetries) {
          await sleep(this.retryBaseMs * 2 ** attempt);
          continue;
        }
        const msg = (errBody as any)?.msg ?? (errBody as any)?.error ?? `HTTP ${res.status}`;
        throw new OctenAPIError(msg, res.status, errBody);
      } catch (e) {
        if (e instanceof OctenAPIError) throw e;
        if ((e as Error).name === "AbortError") { lastErr = new OctenTimeoutError("request timed out"); }
        else lastErr = e;
        if (attempt < this.maxRetries) { await sleep(this.retryBaseMs * 2 ** attempt); continue; }
        throw lastErr;
      } finally {
        clearTimeout(t);
      }
    }
    throw lastErr;
  }

  /** Returns the raw Response for SSE streaming (chat). */
  async stream(endpoint: string, body: unknown, timeoutMs?: number): Promise<Response> {
    const ac = new AbortController();
    if (timeoutMs ?? this.timeoutMs) setTimeout(() => ac.abort(), timeoutMs ?? this.timeoutMs);
    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "POST",
      headers: this.headers(endpoint),
      body: JSON.stringify({ ...(body as object), stream: true }),
      signal: ac.signal,
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new OctenAPIError((errBody as any)?.msg ?? `HTTP ${res.status}`, res.status, errBody);
    }
    return res;
  }
}
