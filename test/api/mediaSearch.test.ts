import { describe, it, expect } from "vitest";
import {
  buildImageSearchRequest,
  buildVideoSearchRequest,
} from "../../src/api/mediaSearch.js";
import { OctenValidationError } from "../../src/api/errors.js";

describe("buildImageSearchRequest", () => {
  it("builds a text-only inputs shape", () => {
    expect(buildImageSearchRequest("red car", {})).toEqual({
      inputs: [{ type: "text", data: "red car" }],
    });
  });
  it("adds an image input for an https url", () => {
    const req = buildImageSearchRequest("red car", {
      image: "https://example.com/car.jpg",
    });
    expect(req).toMatchObject({
      inputs: [
        { type: "text", data: "red car" },
        { type: "image", url: "https://example.com/car.jpg" },
      ],
    });
  });
  it("allows --image alone with no query", () => {
    expect(buildImageSearchRequest("", { image: "https://example.com/car.jpg" })).toEqual({
      inputs: [{ type: "image", url: "https://example.com/car.jpg" }],
    });
  });
  it("requires a query or an image", () => {
    expect(() => buildImageSearchRequest("", {})).toThrow(OctenValidationError);
  });
  it("includes only provided fields", () => {
    expect(buildImageSearchRequest("hi", { count: 5, topic: "design" })).toEqual({
      inputs: [{ type: "text", data: "hi" }],
      count: 5,
      topic: "design",
    });
  });
  it("rejects count out of range", () => {
    expect(() => buildImageSearchRequest("hi", { count: 0 })).toThrow(OctenValidationError);
    expect(() => buildImageSearchRequest("hi", { count: 11 })).toThrow(OctenValidationError);
  });
  it("rejects a bad topic", () => {
    expect(() => buildImageSearchRequest("hi", { topic: "bogus" as never })).toThrow(
      OctenValidationError,
    );
  });
  it("rejects an invalid time-range", () => {
    expect(() => buildImageSearchRequest("hi", { timeRange: "1d" })).toThrow(OctenValidationError);
  });
  it("rejects a bad safesearch", () => {
    expect(() => buildImageSearchRequest("hi", { safesearch: "x" as never })).toThrow(
      OctenValidationError,
    );
  });
  it("maps html-snippet flags into a nested object", () => {
    expect(
      buildImageSearchRequest("hi", { htmlSnippet: true, htmlSnippetMaxTokens: 2000 }),
    ).toMatchObject({ html_snippet: { enable: true, max_tokens: 2000 } });
  });
  it("expands a bare start/end date to start/end of day", () => {
    expect(
      buildImageSearchRequest("hi", { startTime: "2024-01-01", endTime: "2024-12-31" }),
    ).toMatchObject({
      start_time: "2024-01-01T00:00:00Z",
      end_time: "2024-12-31T23:59:59Z",
    });
  });
  it("throws when a local --image file does not exist", () => {
    expect(() =>
      buildImageSearchRequest("hi", { image: "/no/such/file.png" }),
    ).toThrow(OctenValidationError);
  });
});

describe("buildVideoSearchRequest", () => {
  it("builds a text inputs shape", () => {
    expect(buildVideoSearchRequest("espresso guide", {})).toEqual({
      inputs: [{ type: "text", data: "espresso guide" }],
    });
  });
  it("requires a query", () => {
    expect(() => buildVideoSearchRequest("", {})).toThrow(OctenValidationError);
  });
  it("includes only provided fields", () => {
    expect(buildVideoSearchRequest("hi", { count: 3, safesearch: "off" })).toEqual({
      inputs: [{ type: "text", data: "hi" }],
      count: 3,
      safesearch: "off",
    });
  });
  it("rejects count out of range", () => {
    expect(() => buildVideoSearchRequest("hi", { count: 0 })).toThrow(OctenValidationError);
    expect(() => buildVideoSearchRequest("hi", { count: 11 })).toThrow(OctenValidationError);
  });
  it("rejects an invalid time-range", () => {
    expect(() => buildVideoSearchRequest("hi", { timeRange: "1d" })).toThrow(OctenValidationError);
  });
  it("rejects a bad safesearch", () => {
    expect(() => buildVideoSearchRequest("hi", { safesearch: "x" as never })).toThrow(
      OctenValidationError,
    );
  });
  it("expands a bare start/end date to start/end of day", () => {
    expect(
      buildVideoSearchRequest("hi", { startTime: "2024-01-01", endTime: "2024-12-31" }),
    ).toMatchObject({
      start_time: "2024-01-01T00:00:00Z",
      end_time: "2024-12-31T23:59:59Z",
    });
  });
});
