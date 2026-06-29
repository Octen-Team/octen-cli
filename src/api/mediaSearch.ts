import { readFileSync, existsSync, statSync } from "node:fs";
import {
  LIMITS,
  IMAGE_TOPIC_OPTIONS,
  TIME_RANGE_OPTIONS,
  SAFESEARCH_OPTIONS,
} from "./constants.js";
import { OctenValidationError } from "./errors.js";
import { validateEnum, normalizeTimeBound } from "./search.js";

/** Max size of a local image read inline as base64. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

// --- Image search ---

/** A single image-search result. All fields optional — the server is untyped. */
export interface ImageSearchResult {
  title?: string;
  url?: string;
  source_page?: string;
  description?: string;
  width?: number;
  height?: number;
  thumbnail?: string;
  time_published?: string;
  time_last_crawled?: string;
  summary?: string;
  html_snippet?: string;
}

/** Response shape for the /image-search endpoint. */
export interface ImageSearchResponse {
  results?: ImageSearchResult[];
}

export interface ImageSearchOpts {
  /** Optional image input: a public http(s) URL or a local file path. */
  image?: string;
  topic?: "general" | "design";
  count?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  timeRange?: string;
  startTime?: string;
  endTime?: string;
  safesearch?: "off" | "strict";
  htmlSnippet?: boolean;
  htmlSnippetMaxTokens?: number;
}

/** A single image input for the /image-search endpoint. */
type ImageInput =
  | { type: "text"; data: string }
  | { type: "image"; url: string }
  | { type: "image"; data: string };

/**
 * Resolve an image option into an `inputs` entry.
 * - http(s) URL → { type: "image", url }
 * - otherwise treat as a local file path: read raw bytes, base64-encode them
 *   (no data: prefix) → { type: "image", data }. Throws if the file is missing
 *   or larger than 5MB.
 */
function resolveImageInput(value: string): ImageInput {
  if (/^https?:\/\//.test(value)) {
    return { type: "image", url: value };
  }
  if (!existsSync(value)) {
    throw new OctenValidationError(`file not found: ${value}`);
  }
  const { size } = statSync(value);
  if (size > MAX_IMAGE_BYTES) {
    throw new OctenValidationError(
      `file ${value} is ${(size / 1048576).toFixed(1)}MB; max 5MB — pass an https URL instead`,
    );
  }
  const buf = readFileSync(value);
  return { type: "image", data: buf.toString("base64") };
}

export function buildImageSearchRequest(
  query: string,
  o: ImageSearchOpts,
): Record<string, unknown> {
  const inputs: ImageInput[] = [];
  if (query) inputs.push({ type: "text", data: query });
  if (o.image) inputs.push(resolveImageInput(o.image));
  if (inputs.length === 0)
    throw new OctenValidationError("provide a query or --image");

  if (o.count != null && (o.count < LIMITS.imageCount.min || o.count > LIMITS.imageCount.max))
    throw new OctenValidationError(`count must be ${LIMITS.imageCount.min}-${LIMITS.imageCount.max}`);
  validateEnum("--topic", o.topic, IMAGE_TOPIC_OPTIONS);
  validateEnum("--time-range", o.timeRange, TIME_RANGE_OPTIONS);
  validateEnum("--safesearch", o.safesearch, SAFESEARCH_OPTIONS);

  const req: Record<string, unknown> = { inputs };
  const put = (k: string, v: unknown) => { if (v != null) req[k] = v; };
  put("topic", o.topic); put("count", o.count);
  put("include_domains", o.includeDomains); put("exclude_domains", o.excludeDomains);
  put("time_range", o.timeRange);
  put("start_time", normalizeTimeBound("--start-time", o.startTime, false));
  put("end_time", normalizeTimeBound("--end-time", o.endTime, true));
  put("safesearch", o.safesearch);
  if (o.htmlSnippet)
    req.html_snippet = {
      enable: true,
      ...(o.htmlSnippetMaxTokens ? { max_tokens: o.htmlSnippetMaxTokens } : {}),
    };
  return req;
}

// --- Video search ---

/** Matched segment within a video result. */
export interface VideoMatchSegment {
  start_seconds?: number;
  end_seconds?: number;
}

/** A single video-search result. All fields optional — the server is untyped. */
export interface VideoSearchResult {
  title?: string;
  url?: string;
  source_page?: string;
  description?: string;
  cover_url?: string;
  duration_seconds?: number;
  match_segment?: VideoMatchSegment;
  authors?: string[];
  time_published?: string;
  time_last_crawled?: string;
}

/** Response shape for the /video-search endpoint. */
export interface VideoSearchResponse {
  results?: VideoSearchResult[];
}

export interface VideoSearchOpts {
  count?: number;
  timeRange?: string;
  startTime?: string;
  endTime?: string;
  safesearch?: "off" | "strict";
}

/** A single video input for the /video-search endpoint (text only). */
type VideoInput = { type: "text"; data: string };

export function buildVideoSearchRequest(
  query: string,
  o: VideoSearchOpts,
): Record<string, unknown> {
  if (!query) throw new OctenValidationError("query is required");

  if (o.count != null && (o.count < LIMITS.videoCount.min || o.count > LIMITS.videoCount.max))
    throw new OctenValidationError(`count must be ${LIMITS.videoCount.min}-${LIMITS.videoCount.max}`);
  validateEnum("--time-range", o.timeRange, TIME_RANGE_OPTIONS);
  validateEnum("--safesearch", o.safesearch, SAFESEARCH_OPTIONS);

  const inputs: VideoInput[] = [{ type: "text", data: query }];
  const req: Record<string, unknown> = { inputs };
  const put = (k: string, v: unknown) => { if (v != null) req[k] = v; };
  put("count", o.count);
  put("time_range", o.timeRange);
  put("start_time", normalizeTimeBound("--start-time", o.startTime, false));
  put("end_time", normalizeTimeBound("--end-time", o.endTime, true));
  put("safesearch", o.safesearch);
  return req;
}
