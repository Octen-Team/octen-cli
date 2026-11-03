/**
 * Request builder for /place-search.
 *
 * Not a search variant: it shares no options with `/search`. It takes a point
 * (`latitude` + `longitude`, optionally capped by `radius`), or an approximate
 * `user_location` when only the city is known, or neither when the query names
 * its own area. Web results are off by default and nest under `web_search` —
 * the inverse of the other endpoints, where the pages are the answer.
 *
 * Half a coordinate pair, or a radius with no point, is refused here rather
 * than spent on a round trip the API answers with a 400.
 */
import { LIMITS } from "./constants.js";
import { OctenValidationError } from "./errors.js";
import { assertRange } from "./search.js";

export interface PlaceSearchOpts {
  latitude?: number;
  longitude?: number;
  radius?: number;
  city?: string;
  region?: string;
  country?: string;
  count?: number;
  maxReviews?: number;
  web?: boolean;
  webCount?: number;
}

export interface PlaceSearchResponse {
  query?: string;
  location?: Record<string, unknown> | null;
  places?: Array<Record<string, unknown>>;
  results?: Array<Record<string, unknown>>;
}

export function buildPlaceSearchRequest(query: string, o: PlaceSearchOpts): Record<string, unknown> {
  if (!query.trim()) throw new OctenValidationError("query is required");

  const hasLat = o.latitude != null;
  const hasLon = o.longitude != null;
  if (hasLat !== hasLon) {
    const missing = hasLat ? "--longitude" : "--latitude";
    throw new OctenValidationError(`${missing} is required when the other is given — a point needs both`);
  }
  if (o.radius != null && !hasLat)
    throw new OctenValidationError("--radius needs --latitude and --longitude — it measures from that point");

  assertRange("latitude", o.latitude, LIMITS.latitude);
  assertRange("longitude", o.longitude, LIMITS.longitude);
  assertRange("radius", o.radius, LIMITS.placeRadius);
  assertRange("count", o.count, LIMITS.placesCount);
  assertRange("max-reviews", o.maxReviews, LIMITS.maxReviews);
  assertRange("web-count", o.webCount, LIMITS.searchCount);

  const req: Record<string, unknown> = { query };
  const put = (k: string, v: unknown) => { if (v != null) req[k] = v; };
  put("latitude", o.latitude);
  put("longitude", o.longitude);
  put("radius", o.radius);

  // `user_location` is the fallback when coordinates are unknown. The API
  // takes it as an approximate place, so it is only sent when something was
  // actually given for it.
  const loc = [["city", o.city], ["region", o.region], ["country", o.country]]
    .filter(([, v]) => v != null);
  if (loc.length) req.user_location = { type: "approximate", ...Object.fromEntries(loc) };

  const places = [["count", o.count], ["max_reviews", o.maxReviews]].filter(([, v]) => v != null);
  if (places.length) req.places = Object.fromEntries(places);

  // Off unless asked for, matching the server. `--web-count` alone does not
  // turn it on: a count without `--web` would otherwise read as enabling it.
  if (o.web) req.web_search = { enable: true, ...(o.webCount != null ? { count: o.webCount } : {}) };

  return req;
}
