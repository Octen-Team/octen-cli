import { describe, it, expect } from "vitest";
import { buildSearchRequest } from "../../src/api/search.js";
import { OctenValidationError } from "../../src/api/errors.js";

describe("buildSearchRequest", () => {
  it("includes only provided fields", () => {
    expect(buildSearchRequest("hi", { count: 5, topic: "news" }))
      .toEqual({ query: "hi", count: 5, topic: "news" });
  });
  it("rejects count out of range", () => {
    expect(() => buildSearchRequest("hi", { count: 0 })).toThrow(OctenValidationError);
    expect(() => buildSearchRequest("hi", { count: 101 })).toThrow(OctenValidationError);
  });
  it("rejects >5 include-text", () => {
    expect(() => buildSearchRequest("hi", { includeText: ["a","b","c","d","e","f"] })).toThrow(OctenValidationError);
  });
  it("maps highlight flags into a nested object", () => {
    expect(buildSearchRequest("hi", { highlight: true, highlightMaxTokens: 300 }))
      .toMatchObject({ highlight: { enable: true, max_tokens: 300 } });
  });
});
