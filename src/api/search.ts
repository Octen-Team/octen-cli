import {
  LIMITS,
  TOPIC_OPTIONS,
  TIME_BASIS_OPTIONS,
  TIME_RANGE_OPTIONS,
  SAFESEARCH_OPTIONS,
  FORMAT_OPTIONS,
} from "./constants.js";
import { OctenValidationError } from "./errors.js";

function validateEnum(flag: string, value: unknown, allowed: readonly string[]): void {
  if (value != null && !allowed.includes(value as string))
    throw new OctenValidationError(`${flag} must be one of: ${allowed.join(", ")}`);
}

/**
 * Normalize a time bound to an ISO 8601 datetime the API accepts.
 * A bare date (YYYY-MM-DD) is expanded to the start (00:00:00Z) or end
 * (23:59:59Z) of that day; a full datetime passes through. Anything else is
 * rejected client-side with a clear message instead of a server 400.
 */
export function normalizeTimeBound(
  flag: string,
  value: string | undefined,
  endOfDay: boolean,
): string | undefined {
  if (value == null) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return endOfDay ? `${value}T23:59:59Z` : `${value}T00:00:00Z`;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value))) {
    return value;
  }
  throw new OctenValidationError(
    `${flag} must be a date (YYYY-MM-DD) or ISO datetime (e.g. 2024-01-01T00:00:00Z)`,
  );
}

/** A single search result. All fields optional — the server is untyped. */
export interface SearchResult {
  title?: string;
  url?: string;
  highlight?: string;
  full_content?: string;
  time_published?: string;
}

/** Response shape for the /search endpoint. */
export interface SearchResponse {
  results?: SearchResult[];
}

export interface SearchOpts {
  topic?: "general" | "news";
  count?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  includeText?: string[];
  excludeText?: string[];
  timeBasis?: "auto" | "published" | "crawled";
  timeRange?: string;
  startTime?: string;
  endTime?: string;
  format?: "text" | "markdown";
  safesearch?: "off" | "strict";
  highlight?: boolean;
  highlightMaxTokens?: number;
  fullContent?: boolean;
  fullContentMaxTokens?: number;
  images?: boolean;
  videos?: boolean;
}

export function buildSearchRequest(query: string, o: SearchOpts): Record<string, unknown> {
  if (!query) throw new OctenValidationError("query is required");
  if (o.count != null && (o.count < LIMITS.searchCount.min || o.count > LIMITS.searchCount.max))
    throw new OctenValidationError(`count must be ${LIMITS.searchCount.min}-${LIMITS.searchCount.max}`);
  if (o.includeText && o.includeText.length > LIMITS.includeText)
    throw new OctenValidationError(`include-text max ${LIMITS.includeText}`);
  if (o.excludeText && o.excludeText.length > LIMITS.excludeText)
    throw new OctenValidationError(`exclude-text max ${LIMITS.excludeText}`);
  if (o.highlightMaxTokens != null && o.highlightMaxTokens < LIMITS.highlightMaxTokens.min)
    throw new OctenValidationError(
      `highlight-max-tokens must be at least ${LIMITS.highlightMaxTokens.min}`,
    );
  validateEnum("--topic", o.topic, TOPIC_OPTIONS);
  validateEnum("--time-basis", o.timeBasis, TIME_BASIS_OPTIONS);
  validateEnum("--time-range", o.timeRange, TIME_RANGE_OPTIONS);
  validateEnum("--safesearch", o.safesearch, SAFESEARCH_OPTIONS);
  validateEnum("--format", o.format, FORMAT_OPTIONS);

  const req: Record<string, unknown> = { query };
  const put = (k: string, v: unknown) => { if (v != null) req[k] = v; };
  put("topic", o.topic); put("count", o.count);
  put("include_domains", o.includeDomains); put("exclude_domains", o.excludeDomains);
  put("include_text", o.includeText); put("exclude_text", o.excludeText);
  put("time_basis", o.timeBasis); put("time_range", o.timeRange);
  put("start_time", normalizeTimeBound("--start-time", o.startTime, false));
  put("end_time", normalizeTimeBound("--end-time", o.endTime, true));
  put("format", o.format); put("safesearch", o.safesearch);
  put("include_images", o.images); put("include_videos", o.videos);
  if (o.highlight) req.highlight = { enable: true, ...(o.highlightMaxTokens ? { max_tokens: o.highlightMaxTokens } : {}) };
  if (o.fullContent) req.full_content = { enable: true, ...(o.fullContentMaxTokens ? { max_tokens: o.fullContentMaxTokens } : {}) };
  return req;
}
