/**
 * Request builder for /design-search.
 *
 * The endpoint returns two groups of results and takes a block of options for
 * each: `images` — the design references, which are what the search is for —
 * and `web_search`, pages on the same query. Both are on unless switched off,
 * and an option is only ever sent when the caller gave it, so the defaults
 * stay the API's.
 *
 * `images.group_id` replaces the search with a lookup: every image of one page
 * or deck, in order. A lookup needs no query.
 *
 * Refused here rather than spent on a request:
 *  - nothing to search for and no group to fetch;
 *  - a group with the images switched off;
 *  - both groups switched off — the API answers that with an empty success
 *    that still counts as a search;
 *  - an option for a group that is switched off, which does nothing at the API
 *    and is usually typed in the belief that it applies to the other group;
 *  - a full-content cap without `--full-content`, which returns no content.
 */
import { LIMITS, TIME_BASIS_OPTIONS, TIME_RANGE_OPTIONS } from "./constants.js";
import { OctenValidationError } from "./errors.js";
import { assertRange, normalizeTimeBound, validateEnum, type SearchResult } from "./search.js";

export interface DesignSearchOpts {
  // Design references (`images`).
  count?: number;
  group?: string;
  noImages?: boolean;
  noDesignFacts?: boolean;
  noSnippet?: boolean;
  snippetMaxTokens?: number;
  // Web results (`web_search`).
  noWeb?: boolean;
  webCount?: number;
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

/** The page or deck an image belongs to. */
export interface DesignImageGroup {
  group_id?: string;
  type?: string;
  name?: string;
  position?: number;
  total?: number;
  master?: Record<string, unknown>;
}

/** One design reference. All fields optional — the server is untyped. */
export interface DesignImage {
  type?: string;
  title?: string;
  description?: string;
  url?: string;
  thumbnail?: string;
  source_page?: string;
  width?: number;
  height?: number;
  group?: DesignImageGroup;
  design_facts?: Record<string, unknown>;
  snippet?: { format?: string; code?: string };
}

/** Response shape for the /design-search endpoint. */
export interface DesignSearchResponse {
  query?: string;
  images?: DesignImage[];
  results?: SearchResult[];
}

type Given = Array<[flag: string, value: unknown]>;

/** The first option in the list that the caller actually gave. */
function firstGiven(options: Given): string | undefined {
  return options.find(([, v]) => v != null && v !== false)?.[0];
}

/** An object of the fields that were given, or undefined when none were. */
function block(fields: Array<[string, unknown]>): Record<string, unknown> | undefined {
  const set = fields.filter(([, v]) => v != null);
  return set.length ? Object.fromEntries(set) : undefined;
}

export function buildDesignSearchRequest(query: string, o: DesignSearchOpts): Record<string, unknown> {
  const hasQuery = query.trim().length > 0;

  // Trimmed before it is checked, so the id that was checked is the id sent.
  const group = o.group?.trim();
  if (o.group != null && !group) throw new OctenValidationError("--group must not be empty");

  if (!hasQuery && !group)
    throw new OctenValidationError("give a query, or --group <id> to fetch every image of one page or deck");
  if (group && o.noImages)
    throw new OctenValidationError("--group returns images, so it cannot be combined with --no-images");
  if (o.noImages && o.noWeb)
    throw new OctenValidationError("--no-images and --no-web together leave nothing to return");

  const imageOnly: Given = [
    ["--count", o.count],
    ["--no-design-facts", o.noDesignFacts],
    ["--no-snippet", o.noSnippet],
    ["--snippet-max-tokens", o.snippetMaxTokens],
  ];
  const webOnly: Given = [
    ["--web-count", o.webCount],
    ["--include-domains", o.includeDomains],
    ["--exclude-domains", o.excludeDomains],
    ["--language", o.language],
    ["--time-basis", o.timeBasis],
    ["--time-range", o.timeRange],
    ["--start-time", o.startTime],
    ["--end-time", o.endTime],
    ["--highlight", o.highlight],
    ["--highlight-max-tokens", o.highlightMaxTokens],
    ["--full-content", o.fullContent],
    ["--full-content-max-tokens", o.fullContentMaxTokens],
  ];
  const strayImage = o.noImages ? firstGiven(imageOnly) : undefined;
  if (strayImage)
    throw new OctenValidationError(`${strayImage} applies to the design references, which --no-images switches off`);
  const strayWeb = o.noWeb ? firstGiven(webOnly) : undefined;
  if (strayWeb)
    throw new OctenValidationError(`${strayWeb} applies to the web results, which --no-web switches off`);
  if (o.noSnippet && o.snippetMaxTokens != null)
    throw new OctenValidationError("--snippet-max-tokens has no effect with --no-snippet");
  if (o.fullContentMaxTokens != null && !o.fullContent)
    throw new OctenValidationError("--full-content-max-tokens needs --full-content — full content is off unless asked for");

  assertRange("count", o.count, LIMITS.designCount);
  assertRange("snippet-max-tokens", o.snippetMaxTokens, LIMITS.snippetMaxTokens);
  assertRange("web-count", o.webCount, LIMITS.searchCount);
  assertRange("highlight-max-tokens", o.highlightMaxTokens, LIMITS.highlightMaxTokens);
  assertRange("full-content-max-tokens", o.fullContentMaxTokens, LIMITS.fullContentMaxTokens);
  validateEnum("--time-basis", o.timeBasis, TIME_BASIS_OPTIONS);
  validateEnum("--time-range", o.timeRange, TIME_RANGE_OPTIONS);

  const req: Record<string, unknown> = {};
  // Sent as typed; a query of only whitespace beside a group is not sent at all.
  if (hasQuery) req.query = query;

  const images = o.noImages
    ? { enable: false }
    : block([
        ["count", o.count],
        ["design_facts", o.noDesignFacts ? false : undefined],
        ["snippet", o.noSnippet ? { enable: false } : block([["max_tokens", o.snippetMaxTokens]])],
        ["group_id", group],
      ]);
  if (images) req.images = images;

  const web = o.noWeb
    ? { enable: false }
    : block([
        ["count", o.webCount],
        ["include_domains", o.includeDomains],
        ["exclude_domains", o.excludeDomains],
        ["language", o.language],
        ["time_basis", o.timeBasis],
        ["time_range", o.timeRange],
        ["start_time", normalizeTimeBound("--start-time", o.startTime, false)],
        ["end_time", normalizeTimeBound("--end-time", o.endTime, true)],
        // On unless switched off, so a cap alone is a complete request.
        ["highlight", block([["enable", o.highlight ? true : undefined], ["max_tokens", o.highlightMaxTokens]])],
        ["full_content", o.fullContent ? { enable: true, ...block([["max_tokens", o.fullContentMaxTokens]]) } : undefined],
      ]);
  if (web) req.web_search = web;

  return req;
}
