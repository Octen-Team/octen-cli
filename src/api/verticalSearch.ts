/**
 * Request builders for the three search verticals that post to their own
 * endpoints: /news-search, /business-search and /pulse-search.
 *
 * They are not `/search` with a flag. Each takes a subset of the shared
 * retrieval options plus one structured block of its own, and the subsets
 * differ — news and business drop `include_text`/`exclude_text`, `format`,
 * `safesearch` and `include_images`, while pulse drops the domain, text, time
 * and language filters entirely because it runs no retrieval to filter.
 *
 * The API accepts the dropped parameters and ignores them rather than
 * erroring, which is why they are picked explicitly here instead of being
 * derived from `SearchOpts` by omission. Forwarding a parameter the endpoint
 * silently drops is worse than refusing it: the caller gets results that do
 * not reflect what they asked for, with nothing to indicate why.
 */
import {
  LIMITS,
  PULSE_MODE_OPTIONS,
  SAFESEARCH_OPTIONS,
  TIME_BASIS_OPTIONS,
  TIME_RANGE_OPTIONS,
} from "./constants.js";
import { OctenValidationError } from "./errors.js";
import { assertRange, normalizeTimeBound, validateEnum } from "./search.js";

/** Options common to /news-search and /business-search. */
export interface VerticalSearchOpts {
  count?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  language?: string[];
  timeBasis?: "auto" | "published" | "crawled";
  timeRange?: string;
  startTime?: string;
  endTime?: string;
  highlight?: boolean;
  highlightMaxTokens?: number;
  fullContent?: boolean;
  fullContentMaxTokens?: number;
}

export interface NewsSearchOpts extends VerticalSearchOpts {
  subjects?: boolean;
  noSubjects?: boolean;
  subjectsCount?: number;
  maxSubNews?: number;
}

export interface BusinessSearchOpts extends VerticalSearchOpts {
  entities?: boolean;
  noEntities?: boolean;
  entitiesCount?: number;
  maxActivities?: number;
  maxEntityNews?: number;
}

export interface PulseSearchOpts {
  mode?: "lite" | "standard";
  count?: number;
  safesearch?: "off" | "strict";
  images?: boolean;
  highlight?: boolean;
  highlightMaxTokens?: number;
  fullContent?: boolean;
  fullContentMaxTokens?: number;
}

/** Shared validation + field mapping for news and business. */
function buildVerticalOptions(o: VerticalSearchOpts): Record<string, unknown> {
  if (o.count != null && (o.count < LIMITS.searchCount.min || o.count > LIMITS.searchCount.max))
    throw new OctenValidationError(`count must be ${LIMITS.searchCount.min}-${LIMITS.searchCount.max}`);
  assertRange("highlight-max-tokens", o.highlightMaxTokens, LIMITS.highlightMaxTokens);
  assertRange("full-content-max-tokens", o.fullContentMaxTokens, LIMITS.fullContentMaxTokens);
  validateEnum("--time-basis", o.timeBasis, TIME_BASIS_OPTIONS);
  validateEnum("--time-range", o.timeRange, TIME_RANGE_OPTIONS);

  const req: Record<string, unknown> = {};
  const put = (k: string, v: unknown) => { if (v != null) req[k] = v; };
  put("count", o.count);
  put("include_domains", o.includeDomains);
  put("exclude_domains", o.excludeDomains);
  put("language", o.language);
  put("time_basis", o.timeBasis);
  put("time_range", o.timeRange);
  put("start_time", normalizeTimeBound("--start-time", o.startTime, false));
  put("end_time", normalizeTimeBound("--end-time", o.endTime, true));
  if (o.highlight)
    req.highlight = { enable: true, ...(o.highlightMaxTokens ? { max_tokens: o.highlightMaxTokens } : {}) };
  if (o.fullContent)
    req.full_content = { enable: true, ...(o.fullContentMaxTokens ? { max_tokens: o.fullContentMaxTokens } : {}) };
  return req;
}

/**
 * Assemble a structured sub-block (`subjects`, `entities`) only when the
 * caller set something in it.
 *
 * An absent block is not the same as `{enable: false}`: the server turns these
 * on by default, so sending an empty object would be the CLI pinning a default
 * that belongs to the API.
 */
function subBlock(
  disable: boolean | undefined,
  fields: Array<[string, unknown]>,
): Record<string, unknown> | undefined {
  if (disable) return { enable: false };
  const set = fields.filter(([, v]) => v != null);
  return set.length ? Object.fromEntries(set) : undefined;
}

export function buildNewsSearchRequest(query: string, o: NewsSearchOpts): Record<string, unknown> {
  if (!query.trim()) throw new OctenValidationError("query is required");
  assertRange("subjects-count", o.subjectsCount, LIMITS.subjectsCount);
  assertRange("max-sub-news", o.maxSubNews, LIMITS.maxSubNews);

  const req: Record<string, unknown> = { query, ...buildVerticalOptions(o) };
  const subjects = subBlock(o.noSubjects, [
    ["count", o.subjectsCount],
    ["max_sub_news", o.maxSubNews],
  ]);
  if (subjects) req.subjects = subjects;
  return req;
}

export function buildBusinessSearchRequest(query: string, o: BusinessSearchOpts): Record<string, unknown> {
  if (!query.trim()) throw new OctenValidationError("query is required");
  assertRange("entities-count", o.entitiesCount, LIMITS.entitiesCount);
  assertRange("max-activities", o.maxActivities, LIMITS.maxActivities);
  assertRange("max-entity-news", o.maxEntityNews, LIMITS.maxEntityNews);

  const req: Record<string, unknown> = { query, ...buildVerticalOptions(o) };
  const entities = subBlock(o.noEntities, [
    ["count", o.entitiesCount],
    ["max_activities", o.maxActivities],
    ["max_news", o.maxEntityNews],
  ]);
  if (entities) req.entities = entities;
  return req;
}

export function buildPulseSearchRequest(query: string, o: PulseSearchOpts): Record<string, unknown> {
  if (!query.trim()) throw new OctenValidationError("query is required");
  if (query.length > LIMITS.pulseQueryLength)
    throw new OctenValidationError(`query must be at most ${LIMITS.pulseQueryLength} characters`);
  if (o.count != null && (o.count < LIMITS.pulseCount.min || o.count > LIMITS.pulseCount.max))
    throw new OctenValidationError(`count must be ${LIMITS.pulseCount.min}-${LIMITS.pulseCount.max}`);
  assertRange("highlight-max-tokens", o.highlightMaxTokens, LIMITS.highlightMaxTokens);
  assertRange("full-content-max-tokens", o.fullContentMaxTokens, LIMITS.fullContentMaxTokens);
  validateEnum("--mode", o.mode, PULSE_MODE_OPTIONS);
  validateEnum("--safesearch", o.safesearch, SAFESEARCH_OPTIONS);

  const req: Record<string, unknown> = { query };
  const put = (k: string, v: unknown) => { if (v != null) req[k] = v; };
  put("mode", o.mode);
  put("count", o.count);
  put("safesearch", o.safesearch);
  put("include_images", o.images);
  if (o.highlight)
    req.highlight = { enable: true, ...(o.highlightMaxTokens ? { max_tokens: o.highlightMaxTokens } : {}) };
  if (o.fullContent)
    req.full_content = { enable: true, ...(o.fullContentMaxTokens ? { max_tokens: o.fullContentMaxTokens } : {}) };
  return req;
}
