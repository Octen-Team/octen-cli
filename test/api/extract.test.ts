import { describe, it, expect } from "vitest";
import { buildExtractRequest } from "../../src/api/extract.js";
import { OctenValidationError } from "../../src/api/errors.js";

describe("buildExtractRequest", () => {
  it("includes only provided fields", () => {
    const req = buildExtractRequest(["https://example.com"], { query: "test", format: "markdown" });
    expect(req).toEqual({ urls: ["https://example.com"], query: "test", format: "markdown" });
  });

  it("includes no optional fields when only urls are given", () => {
    const req = buildExtractRequest(["https://example.com"], {});
    expect(req).toEqual({ urls: ["https://example.com"] });
  });

  it("rejects 0 urls", () => {
    expect(() => buildExtractRequest([], {})).toThrow(OctenValidationError);
  });

  it("rejects 21 urls", () => {
    const urls = Array.from({ length: 21 }, (_, i) => `https://example${i}.com`);
    expect(() => buildExtractRequest(urls, {})).toThrow(OctenValidationError);
  });

  it("rejects fetchTimeout=0", () => {
    expect(() => buildExtractRequest(["https://example.com"], { fetchTimeout: 0 })).toThrow(OctenValidationError);
  });

  it("rejects fetchTimeout=61", () => {
    expect(() => buildExtractRequest(["https://example.com"], { fetchTimeout: 61 })).toThrow(OctenValidationError);
  });

  it("accepts fetchTimeout=1 and fetchTimeout=60", () => {
    expect(() => buildExtractRequest(["https://example.com"], { fetchTimeout: 1 })).not.toThrow();
    expect(() => buildExtractRequest(["https://example.com"], { fetchTimeout: 60 })).not.toThrow();
  });

  it("auto-prefixes bare host with https://", () => {
    const req = buildExtractRequest(["example.com"], {});
    expect((req.urls as string[])[0]).toBe("https://example.com");
  });

  it("does not double-prefix urls that already have a scheme", () => {
    const req = buildExtractRequest(["https://example.com", "http://other.com"], {});
    expect(req.urls).toEqual(["https://example.com", "http://other.com"]);
  });

  it("rejects maxAge below the 300s minimum", () => {
    expect(() => buildExtractRequest(["https://example.com"], { maxAge: 100 })).toThrow(
      OctenValidationError,
    );
  });

  it("rejects maxAge above the maximum", () => {
    expect(() =>
      buildExtractRequest(["https://example.com"], { maxAge: 99_999_999_999 }),
    ).toThrow(OctenValidationError);
  });

  it("accepts maxAge at the boundaries and within range", () => {
    expect((buildExtractRequest(["https://example.com"], { maxAge: 300 })).max_age_seconds).toBe(300);
    expect((buildExtractRequest(["https://example.com"], { maxAge: 86400 })).max_age_seconds).toBe(86400);
  });

  it("rejects a bare word that is not a plausible URL", () => {
    expect(() => buildExtractRequest(["not-a-valid-url"], {})).toThrow(OctenValidationError);
  });

  it("rejects non-http(s) schemes", () => {
    expect(() => buildExtractRequest(["ftp://example.com"], {})).toThrow(OctenValidationError);
  });

  it("accepts localhost and IP hosts", () => {
    expect(() => buildExtractRequest(["localhost:3000"], {})).not.toThrow();
    expect(() => buildExtractRequest(["http://127.0.0.1:8080"], {})).not.toThrow();
  });

  it("maps fetchTimeout to timeout in body", () => {
    const req = buildExtractRequest(["https://example.com"], { fetchTimeout: 30 });
    expect(req.timeout).toBe(30);
    expect(req.fetchTimeout).toBeUndefined();
  });

  it("maps boolean media flags", () => {
    const req = buildExtractRequest(["https://example.com"], {
      images: true,
      videos: true,
      audio: true,
      favicon: true,
    });
    expect(req.include_images).toBe(true);
    expect(req.include_videos).toBe(true);
    expect(req.include_audio).toBe(true);
    expect(req.include_favicon).toBe(true);
  });
});
