import { LIMITS } from "./constants.js";
import { OctenValidationError } from "./errors.js";

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

  const req: Record<string, unknown> = { query };
  const put = (k: string, v: unknown) => { if (v != null) req[k] = v; };
  put("topic", o.topic); put("count", o.count);
  put("include_domains", o.includeDomains); put("exclude_domains", o.excludeDomains);
  put("include_text", o.includeText); put("exclude_text", o.excludeText);
  put("time_basis", o.timeBasis); put("time_range", o.timeRange);
  put("start_time", o.startTime); put("end_time", o.endTime);
  put("format", o.format); put("safesearch", o.safesearch);
  put("include_images", o.images); put("include_videos", o.videos);
  if (o.highlight) req.highlight = { enable: true, ...(o.highlightMaxTokens ? { max_tokens: o.highlightMaxTokens } : {}) };
  if (o.fullContent) req.full_content = { enable: true, ...(o.fullContentMaxTokens ? { max_tokens: o.fullContentMaxTokens } : {}) };
  return req;
}
