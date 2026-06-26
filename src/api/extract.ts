import { LIMITS } from "./constants.js";
import { OctenValidationError } from "./errors.js";

/** A single extracted item. All fields optional — the server is untyped. */
export interface ExtractItem {
  url?: string;
  status?: string;
  title?: string;
  category?: { primary?: string; secondary?: string };
  page_structure?: { primary?: string; secondary?: string };
  time_published?: string;
  full_content?: string;
  highlights?: string[];
  error_message?: string;
}

/** Response shape for the /extract endpoint. */
export interface ExtractResponse {
  items?: ExtractItem[];
  results?: ExtractItem[];
}

export interface ExtractOpts {
  query?: string;
  maxAge?: number;
  format?: "markdown" | "text";
  fetchTimeout?: number;
  images?: boolean;
  videos?: boolean;
  audio?: boolean;
  favicon?: boolean;
}

/**
 * Auto-prefix bare hosts with https:// and reject inputs that are not plausible
 * http(s) URLs, so obvious typos fail client-side instead of being silently
 * sent to the server (which reports them as failed but still accepts the call).
 */
export function normalizeExtractUrl(raw: string): string {
  const candidate = raw.includes("://") ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new OctenValidationError(`invalid URL: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new OctenValidationError(`invalid URL (only http/https): ${raw}`);
  const host = parsed.hostname;
  // A real host is a domain (has a dot), an IP/IPv6 (has a colon), or localhost.
  if (host !== "localhost" && !host.includes(".") && !host.includes(":"))
    throw new OctenValidationError(
      `invalid URL: ${raw} (expected a domain like example.com or a full https:// URL)`,
    );
  return candidate;
}

export function buildExtractRequest(urls: string[], o: ExtractOpts): Record<string, unknown> {
  if (urls.length < LIMITS.extractUrls.min || urls.length > LIMITS.extractUrls.max)
    throw new OctenValidationError(
      `urls must be ${LIMITS.extractUrls.min}-${LIMITS.extractUrls.max} items`,
    );

  if (o.fetchTimeout != null && (o.fetchTimeout < LIMITS.extractTimeout.min || o.fetchTimeout > LIMITS.extractTimeout.max))
    throw new OctenValidationError(
      `fetch-timeout must be ${LIMITS.extractTimeout.min}-${LIMITS.extractTimeout.max}`,
    );

  if (o.maxAge != null && (o.maxAge < LIMITS.cacheWindow.min || o.maxAge > LIMITS.cacheWindow.max))
    throw new OctenValidationError(
      `max-age must be ${LIMITS.cacheWindow.min}-${LIMITS.cacheWindow.max} seconds`,
    );

  const normalizedUrls = urls.map(normalizeExtractUrl);
  const maxAge = o.maxAge;

  const req: Record<string, unknown> = { urls: normalizedUrls };
  const put = (k: string, v: unknown) => { if (v != null) req[k] = v; };

  put("query", o.query);
  put("max_age_seconds", maxAge);
  put("format", o.format);
  put("timeout", o.fetchTimeout);
  put("include_images", o.images);
  put("include_videos", o.videos);
  put("include_audio", o.audio);
  put("include_favicon", o.favicon);

  return req;
}
