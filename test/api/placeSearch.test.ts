import { describe, it, expect } from "vitest";
import { buildPlaceSearchRequest } from "../../src/api/placeSearch.js";
import { OctenValidationError } from "../../src/api/errors.js";

describe("buildPlaceSearchRequest", () => {
  it("includes only provided fields", () => {
    expect(buildPlaceSearchRequest("coffee shop", {})).toEqual({ query: "coffee shop" });
  });

  it("sends a full coordinate pair with a radius", () => {
    expect(buildPlaceSearchRequest("ramen", { latitude: 35.6812, longitude: 139.7671, radius: 500 }))
      .toEqual({ query: "ramen", latitude: 35.6812, longitude: 139.7671, radius: 500 });
  });

  it("refuses half a coordinate pair before the call", () => {
    expect(() => buildPlaceSearchRequest("q", { latitude: 35.6 })).toThrow(/longitude/);
    expect(() => buildPlaceSearchRequest("q", { longitude: 139.7 })).toThrow(/latitude/);
  });

  it("refuses a radius with no point", () => {
    expect(() => buildPlaceSearchRequest("q", { radius: 500 })).toThrow(OctenValidationError);
  });

  it("nests max_reviews under places", () => {
    expect(buildPlaceSearchRequest("coffee", { count: 2, maxReviews: 3 })).toMatchObject({
      places: { count: 2, max_reviews: 3 },
    });
  });

  it("omits places entirely when neither sub-option is set", () => {
    expect(buildPlaceSearchRequest("coffee", {})).not.toHaveProperty("places");
  });

  it("accepts max_reviews 0 and rejects 6 — the API caps it at 5", () => {
    expect(buildPlaceSearchRequest("q", { maxReviews: 0 })).toMatchObject({ places: { max_reviews: 0 } });
    expect(() => buildPlaceSearchRequest("q", { maxReviews: 6 })).toThrow(OctenValidationError);
  });

  it("builds user_location from the approximate fields", () => {
    expect(buildPlaceSearchRequest("museums", { city: "Lisbon", country: "PT" })).toMatchObject({
      user_location: { type: "approximate", city: "Lisbon", country: "PT" },
    });
  });

  it("omits user_location when no approximate field was given", () => {
    expect(buildPlaceSearchRequest("museums", {})).not.toHaveProperty("user_location");
  });

  it("web search is off unless --web, and a count alone does not enable it", () => {
    expect(buildPlaceSearchRequest("q", {})).not.toHaveProperty("web_search");
    expect(buildPlaceSearchRequest("q", { webCount: 5 })).not.toHaveProperty("web_search");
    expect(buildPlaceSearchRequest("q", { web: true, webCount: 5 })).toMatchObject({
      web_search: { enable: true, count: 5 },
    });
  });

  it("rejects coordinates outside their documented range", () => {
    expect(() => buildPlaceSearchRequest("q", { latitude: 91, longitude: 0 })).toThrow(OctenValidationError);
    expect(() => buildPlaceSearchRequest("q", { latitude: 0, longitude: 181 })).toThrow(OctenValidationError);
    expect(() => buildPlaceSearchRequest("q", { latitude: 0, longitude: 0, radius: 50_001 }))
      .toThrow(OctenValidationError);
  });
});
