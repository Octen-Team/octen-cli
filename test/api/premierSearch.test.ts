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

  // Measured against the API: a `highlight` block that carries no `enable`
  // returns no highlights at all, whatever the documented default. So a cap is
  // sent as what it means — highlights, this long.
  it("sends a highlight cap given on its own, with highlights switched on", () => {
    expect(buildPremierSearchRequest("q", { highlightMaxTokens: 300 })).toEqual({
      query: "q",
      highlight: { enable: true, max_tokens: 300 },
    });
  });

  it("still range-checks a highlight cap given on its own", () => {
    expect(() => buildPremierSearchRequest("q", { highlightMaxTokens: 50 })).toThrow(OctenValidationError);
  });

  // Full content is off unless asked for, and measured: a cap alone returns
  // none. Dropping the cap would hide that; switching a billed option on from
  // a flag that did not name it would be worse.
  it("refuses a full-content cap without --full-content", () => {
    const build = () => buildPremierSearchRequest("q", { fullContentMaxTokens: 500 });
    expect(build).toThrow(OctenValidationError);
    expect(build).toThrow(/--full-content-max-tokens needs --full-content/);
    expect(buildPremierSearchRequest("q", { fullContent: true, fullContentMaxTokens: 500 })).toEqual({
      query: "q",
      full_content: { enable: true, max_tokens: 500 },
    });
  });

  it("applies the shared range checks", () => {
    expect(() => buildPremierSearchRequest("q", { count: 101 })).toThrow(OctenValidationError);
    expect(() => buildPremierSearchRequest("q", { highlight: true, highlightMaxTokens: 50 })).toThrow(OctenValidationError);
  });
});
