/**
 * Request builder for /search-premier.
 *
 * The API reference gives this endpoint the request body of `/search`, so the
 * shared options go through the search builder rather than a second copy of
 * it. Kept here are the places where this command differs from `search`:
 *
 *  - `topic`, which is `search`'s own and is never forwarded;
 *  - a token cap given without its switch. The search builder sends a cap only
 *    beside `--highlight` / `--full-content` and drops it otherwise. Here a
 *    highlight cap is sent, and a full-content cap is refused — see below.
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

  // Full content is off unless asked for, and the API returns none for a cap
  // sent alone. Dropping the cap would hide that; switching a billed option on
  // from a flag that did not name it would be worse.
  if (o.fullContentMaxTokens != null && !o.fullContent)
    throw new OctenValidationError("--full-content-max-tokens needs --full-content — full content is off unless asked for");

  // Dropped by name, not by type: an options object built for `search` would
  // otherwise carry its `topic` straight through. `resultType` is appended
  // after the shared options so the body's key order stays as it was.
  const { topic: _topic, resultType, ...shared } = o as PremierSearchOpts & Pick<SearchOpts, "topic">;

  // A highlight cap is a request for highlights of that length, so it is sent
  // as one. It has to carry `enable`: the API returns no highlights at all for
  // a `highlight` block without it, whatever the documented default.
  const highlight = shared.highlight || shared.highlightMaxTokens != null;

  const req: Record<string, unknown> = { query, ...buildSearchOptions({ ...shared, highlight }) };
  if (resultType != null) req.result_type = resultType;
  return req;
}
