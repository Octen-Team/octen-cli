import { describe, it, expect } from "vitest";
import { buildBroadSearchRequest } from "../../src/api/search.js";
import { OctenValidationError } from "../../src/api/errors.js";

describe("buildBroadSearchRequest", () => {
  it("nests per-query options under search_options and keeps query/max_queries at top level", () => {
    expect(buildBroadSearchRequest("hi", { maxQueries: 3, count: 10, topic: "news" })).toEqual({
      query: "hi",
      max_queries: 3,
      search_options: { count: 10, topic: "news" },
    });
  });
  it("omits search_options when no per-query options are given", () => {
    expect(buildBroadSearchRequest("hi", { maxQueries: 2 })).toEqual({
      query: "hi",
      max_queries: 2,
    });
  });
  it("omits max_queries when not provided (server default applies)", () => {
    expect(buildBroadSearchRequest("hi", { count: 5 })).toEqual({
      query: "hi",
      search_options: { count: 5 },
    });
  });
  it("rejects max-queries out of range", () => {
    expect(() => buildBroadSearchRequest("hi", { maxQueries: 0 })).toThrow(OctenValidationError);
    expect(() => buildBroadSearchRequest("hi", { maxQueries: 31 })).toThrow(OctenValidationError);
  });
  it("requires a query", () => {
    expect(() => buildBroadSearchRequest("", { maxQueries: 3 })).toThrow(OctenValidationError);
  });
  it("validates inner search options too (count range, enums)", () => {
    expect(() => buildBroadSearchRequest("hi", { count: 101 })).toThrow(OctenValidationError);
    expect(() => buildBroadSearchRequest("hi", { topic: "bogus" as never })).toThrow(OctenValidationError);
  });
  it("maps highlight/full_content into nested objects inside search_options", () => {
    expect(buildBroadSearchRequest("hi", { highlight: true, highlightMaxTokens: 300 })).toMatchObject({
      search_options: { highlight: { enable: true, max_tokens: 300 } },
    });
  });
});
