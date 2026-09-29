import { EXTRACT_MODE_OPTIONS, LIMITS, LINK_SCOPE_OPTIONS } from "./constants.js";
import { OctenValidationError } from "./errors.js";
import { validateEnum } from "./search.js";

export type ExtractMode = (typeof EXTRACT_MODE_OPTIONS)[number];
export type LinkScope = (typeof LINK_SCOPE_OPTIONS)[number];

/** A link found on an extracted page (only when include_links was requested). */
export interface ExtractLink {
  url?: string;
  anchor_text?: string;
  is_external?: boolean;
}

/** A single extracted item. All fields optional — the server is untyped. */
export interface ExtractItem {
  url?: string;
  status?: string;
  /**
   * The mode actually used for this URL; present on success only. It can differ
   * from the requested mode (auto picks per URL, advanced may resolve to standard).
   */
  resolved_mode?: "standard" | "advanced";
  title?: string;
  category?: { primary?: string; secondary?: string };
  page_structure?: { primary?: string; secondary?: string };
  time_published?: string;
  time_last_crawled?: string;
  full_content?: string;
  highlights?: string[];
  favicon?: string;
  cover_image?: { url?: string };
  images?: { url?: string }[];
  videos?: { url?: string }[];
  audio?: { url?: string }[];
  links?: ExtractLink[];
  error_message?: string;
}

/** Response shape for the /extract endpoint. */
export interface ExtractResponse {
  items?: ExtractItem[];
  results?: ExtractItem[];
}

/**
 * Top-level `meta` of an /extract response — a sibling of `data`, not inside it.
 * Billing is authoritative from `usage.successful_by_mode`, not from summing
 * each item's `resolved_mode`.
 */
export interface ExtractMeta {
  usage?: {
    total_urls?: number;
    successful_urls?: number;
    successful_by_mode?: { standard_urls?: number; advanced_urls?: number };
  };
  latency?: number;
  /** e.g. "1 URL(s) failed and were not billed"; empty when there is nothing to report. */
  warning?: string;
}

/** The full /extract envelope as the client returns it. */
export interface ExtractEnvelope {
  data?: ExtractResponse;
  meta?: ExtractMeta;
  code?: number;
  msg?: string;
}

export interface ExtractOpts {
  query?: string;
  maxAge?: number;
  format?: "markdown" | "text";
  fetchTimeout?: number;
  images?: boolean;
  videos?: boolean;
  audio?: boolean;
  /** Omitted unless given: the server defaults to standard, and we never inject one. */
  mode?: ExtractMode;
  /** `--links` alone is `true` (server defaults); `--links <scope>` is the scope string. */
  links?: boolean | string;
  maxLinks?: number;
}

/**
 * `timeout` in the body is the server-side, per-URL fetch budget, so it cannot
 * double as the client ceiling: a 20-URL call, or one in advanced/auto mode, can
 * legitimately outlast it. Allow the per-URL budget plus headroom for the
 * server's own fan-out, bounded so a wedged request still fails. Mirrors octen-mcp.
 */
const EXTRACT_SERVER_TIMEOUT_DEFAULT_SEC = 30;
const EXTRACT_CLIENT_HEADROOM_SEC = 90;
// Unreachable from the CLI (--fetch-timeout <= 60 gives at most 150s); kept to
// mirror octen-mcp and to bound any programmatic caller that skips validation.
const EXTRACT_CLIENT_TIMEOUT_CAP_SEC = 180;

/** Whole-request client timeout (ms) for one /extract call. */
export function extractClientTimeoutMs(fetchTimeout?: number): number {
  const sec = Math.min(
    EXTRACT_CLIENT_TIMEOUT_CAP_SEC,
    (fetchTimeout ?? EXTRACT_SERVER_TIMEOUT_DEFAULT_SEC) + EXTRACT_CLIENT_HEADROOM_SEC,
  );
  return sec * 1000;
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

  validateEnum("--mode", o.mode, EXTRACT_MODE_OPTIONS);
  // Commander yields `true` for a bare `--links`; only a string names a scope. The
  // CLI's option parser already checked it; this keeps programmatic callers honest.
  const scope = typeof o.links === "string" ? o.links : undefined;
  validateEnum("--links", scope, LINK_SCOPE_OPTIONS);

  // Out-of-range max_links is a server 400 (not clamped like timeout), so check here.
  if (o.maxLinks != null && (o.maxLinks < LIMITS.maxLinks.min || o.maxLinks > LIMITS.maxLinks.max))
    throw new OctenValidationError(
      `max-links must be ${LIMITS.maxLinks.min}-${LIMITS.maxLinks.max}`,
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
  put("mode", o.mode);

  // --links and --max-links both opt in; `{}` lets the server apply its defaults.
  if (o.links || o.maxLinks != null) {
    const includeLinks: Record<string, unknown> = {};
    if (scope != null) includeLinks.scope = scope;
    if (o.maxLinks != null) includeLinks.max_links = o.maxLinks;
    req.include_links = includeLinks;
  }

  return req;
}
