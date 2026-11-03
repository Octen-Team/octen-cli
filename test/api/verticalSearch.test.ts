import { describe, it, expect } from "vitest";
import {
  buildBusinessSearchRequest,
  buildNewsSearchRequest,
  buildPulseSearchRequest,
} from "../../src/api/verticalSearch.js";
import { OctenValidationError } from "../../src/api/errors.js";

describe("buildNewsSearchRequest", () => {
  it("includes only provided fields", () => {
    expect(buildNewsSearchRequest("eu ai act", { count: 5 })).toEqual({
      query: "eu ai act",
      count: 5,
    });
  });

  it("does not forward the options /news-search ignores", () => {
    // The endpoint accepts include_text, format, safesearch and include_images
    // and silently drops them. Forwarding would hand back results that do not
    // reflect the flags given, with nothing to say why.
    const req = buildNewsSearchRequest("x", {
      count: 1,
      includeText: ["ai"],
      format: "markdown",
      safesearch: "strict",
      images: true,
    } as never);
    for (const key of ["include_text", "format", "safesearch", "include_images"]) {
      expect(req).not.toHaveProperty(key);
    }
  });

  it("sends subjects only when something was set", () => {
    expect(buildNewsSearchRequest("x", {})).not.toHaveProperty("subjects");
    expect(buildNewsSearchRequest("x", { subjectsCount: 3 })).toMatchObject({
      subjects: { count: 3 },
    });
  });

  it("--no-subjects turns the clustering off explicitly", () => {
    expect(buildNewsSearchRequest("x", { noSubjects: true })).toMatchObject({
      subjects: { enable: false },
    });
  });

  it("rejects out-of-range subject counts", () => {
    expect(() => buildNewsSearchRequest("x", { subjectsCount: 6 })).toThrow(OctenValidationError);
    expect(() => buildNewsSearchRequest("x", { maxSubNews: 21 })).toThrow(OctenValidationError);
  });

  it("requires a query", () => {
    expect(() => buildNewsSearchRequest("  ", {})).toThrow(OctenValidationError);
  });
});

describe("buildBusinessSearchRequest", () => {
  it("nests the entity options", () => {
    expect(buildBusinessSearchRequest("nvidia", { entitiesCount: 2, maxEntityNews: 3 })).toEqual({
      query: "nvidia",
      entities: { count: 2, max_news: 3 },
    });
  });

  it("--no-entities returns sources only", () => {
    expect(buildBusinessSearchRequest("x", { noEntities: true })).toMatchObject({
      entities: { enable: false },
    });
  });

  it("maps the shared retrieval filters", () => {
    const req = buildBusinessSearchRequest("x", {
      includeDomains: ["reuters.com"],
      language: ["en"],
      timeRange: "week",
      highlight: true,
      highlightMaxTokens: 300,
    });
    expect(req).toMatchObject({
      include_domains: ["reuters.com"],
      language: ["en"],
      time_range: "week",
      highlight: { enable: true, max_tokens: 300 },
    });
  });

  it("rejects out-of-range entity counts", () => {
    expect(() => buildBusinessSearchRequest("x", { entitiesCount: 21 })).toThrow(OctenValidationError);
  });
});

describe("buildPulseSearchRequest", () => {
  it("includes only provided fields", () => {
    expect(buildPulseSearchRequest("uv docs", { mode: "lite", count: 3 })).toEqual({
      query: "uv docs",
      mode: "lite",
      count: 3,
    });
  });

  it("takes none of the retrieval filters — it runs no retrieval", () => {
    const req = buildPulseSearchRequest("x", {
      includeDomains: ["a.com"],
      language: ["en"],
      timeRange: "week",
    } as never);
    for (const key of ["include_domains", "language", "time_range"]) {
      expect(req).not.toHaveProperty(key);
    }
  });

  it("rejects a bad mode and an out-of-range count", () => {
    expect(() => buildPulseSearchRequest("x", { mode: "turbo" as never })).toThrow(OctenValidationError);
    expect(() => buildPulseSearchRequest("x", { count: 11 })).toThrow(OctenValidationError);
  });

  it("rejects a query past the documented 500-character limit", () => {
    expect(() => buildPulseSearchRequest("a".repeat(501), {})).toThrow(OctenValidationError);
    expect(() => buildPulseSearchRequest("a".repeat(500), {})).not.toThrow();
  });
});
