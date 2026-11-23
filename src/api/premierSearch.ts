/**
 * Request builder for /search-premier.
 *
 * The API reference gives this endpoint the request body of `/search`, so the
 * shared options go through the search builder rather than a second copy of
 * it. Two differences are kept here: `result_type`, which the reference
 * documents and the `search` command does not offer, and `topic`, which is
 * `search`'s own and is never forwarded.
 */
import { RESULT_TYPE_OPTIONS } from "./constants.js";
import { OctenValidationError } from "./errors.js";
import { buildSearchOptions, validateEnum, type SearchOpts } from "./search.js";

export interface PremierSearchOpts extends Omit<SearchOpts, "topic"> {
  resultType?: (typeof RESULT_TYPE_OPTIONS)[number];
}

export function buildPremierSearchRequest(query: string, o: PremierSearchOpts): Record<string, unknown> {
  if (query.trim().length === 0) throw new OctenValidationError("query is required");
  validateEnum("--result-type", o.resultType, RESULT_TYPE_OPTIONS);

  // Dropped by name, not by type: an options object built for `search` would
  // otherwise carry its `topic` straight through.
  const { topic: _topic, resultType, ...shared } = o as PremierSearchOpts & Pick<SearchOpts, "topic">;

  const req: Record<string, unknown> = { query, ...buildSearchOptions(shared) };
  if (resultType != null) req.result_type = resultType;
  return req;
}
