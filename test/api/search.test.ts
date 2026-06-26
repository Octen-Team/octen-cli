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
  it("rejects an invalid time-range with a helpful message", () => {
    expect(() => buildSearchRequest("hi", { timeRange: "1d" })).toThrow(OctenValidationError);
    expect(() => buildSearchRequest("hi", { timeRange: "1d" })).toThrow(/time-range/);
  });
  it("accepts valid time-range values", () => {
    expect(buildSearchRequest("hi", { timeRange: "day" })).toMatchObject({ time_range: "day" });
    expect(buildSearchRequest("hi", { timeRange: "d" })).toMatchObject({ time_range: "d" });
    expect(buildSearchRequest("hi", { timeRange: "week" })).toMatchObject({ time_range: "week" });
  });
  it("rejects an invalid topic", () => {
    expect(() => buildSearchRequest("hi", { topic: "bogus" as never })).toThrow(OctenValidationError);
  });
  it("rejects an invalid safesearch", () => {
    expect(() => buildSearchRequest("hi", { safesearch: "x" as never })).toThrow(OctenValidationError);
  });
  it("rejects an invalid format", () => {
    expect(() => buildSearchRequest("hi", { format: "x" as never })).toThrow(OctenValidationError);
  });
  it("rejects highlight-max-tokens below the 100 minimum", () => {
    expect(() => buildSearchRequest("hi", { highlight: true, highlightMaxTokens: 50 })).toThrow(
      OctenValidationError,
    );
  });
  it("expands a bare start/end date to start/end of day", () => {
    expect(buildSearchRequest("hi", { startTime: "2024-01-01", endTime: "2024-12-31" })).toMatchObject({
      start_time: "2024-01-01T00:00:00Z",
      end_time: "2024-12-31T23:59:59Z",
    });
  });
  it("passes a full ISO datetime through unchanged", () => {
    expect(buildSearchRequest("hi", { startTime: "2024-01-01T08:30:00Z" })).toMatchObject({
      start_time: "2024-01-01T08:30:00Z",
    });
  });
  it("rejects an unparseable time bound", () => {
    expect(() => buildSearchRequest("hi", { startTime: "last tuesday" })).toThrow(OctenValidationError);
  });
});
