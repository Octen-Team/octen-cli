import { describe, it, expect } from "vitest";
import { buildPremierSearchRequest } from "../../src/api/premierSearch.js";
import { buildSearchRequest, type SearchOpts } from "../../src/api/search.js";
import { OctenValidationError } from "../../src/api/errors.js";

describe("buildPremierSearchRequest", () => {
  it("includes only provided fields", () => {
    expect(buildPremierSearchRequest("q", {})).toEqual({ query: "q" });
  });

  // The reference gives /search-premier the request body of /search, so every
  // option the two share has to map the same way — otherwise swapping one
  // command for the other changes more than the endpoint.
  it("maps every shared option exactly as the search builder does", () => {
    const shared: SearchOpts = {
      count: 7,
      includeDomains: ["a.com"],
      excludeDomains: ["b.com"],
      includeText: ["x"],
      excludeText: ["y"],
      timeBasis: "published",
      timeRange: "week",
      startTime: "2024-01-01",
      endTime: "2024-01-31",
      format: "markdown",
      safesearch: "off",
      language: ["en", "ja"],
      highlight: true,
      highlightMaxTokens: 300,
      fullContent: true,
      fullContentMaxTokens: 1000,
      images: true,
    };
    const premier = buildPremierSearchRequest("q", shared);
    expect(Object.keys(premier).length).toBeGreaterThan(10);
    expect(premier).toEqual(buildSearchRequest("q", shared));
  });

  it("forwards result_type when given, and leaves it to the server otherwise", () => {
    expect(buildPremierSearchRequest("q", { resultType: "dynamic" })).toEqual({ query: "q", result_type: "dynamic" });
    expect(buildPremierSearchRequest("q", { resultType: "standard" })).toEqual({ query: "q", result_type: "standard" });
    expect(buildPremierSearchRequest("q", {})).not.toHaveProperty("result_type");
  });

  it("rejects an unknown result type, naming the flag", () => {
    expect(() => buildPremierSearchRequest("q", { resultType: "deep" as never })).toThrow(OctenValidationError);
    expect(() => buildPremierSearchRequest("q", { resultType: "deep" as never })).toThrow(/--result-type/);
  });

  // `topic` is search's own option; the reference does not list it for this
  // endpoint, so it must not leak through from a shared options object.
  it("never sends topic", () => {
    const req = buildPremierSearchRequest("q", { topic: "news", count: 3 } as never);
    expect(req).toEqual({ query: "q", count: 3 });
  });

  it("refuses a blank query", () => {
    expect(() => buildPremierSearchRequest("   ", {})).toThrow(OctenValidationError);
  });

  it("applies the shared range checks", () => {
    expect(() => buildPremierSearchRequest("q", { count: 101 })).toThrow(OctenValidationError);
    expect(() => buildPremierSearchRequest("q", { highlight: true, highlightMaxTokens: 50 })).toThrow(OctenValidationError);
  });
});
