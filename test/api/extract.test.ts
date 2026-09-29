import { describe, it, expect } from "vitest";
import { buildExtractRequest, extractClientTimeoutMs } from "../../src/api/extract.js";
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
    });
    expect(req.include_images).toBe(true);
    expect(req.include_videos).toBe(true);
    expect(req.include_audio).toBe(true);
  });

  it("omits mode when not given (the server defaults to standard)", () => {
    const req = buildExtractRequest(["https://example.com"], {});
    expect(req).not.toHaveProperty("mode");
  });

  it("passes each valid mode through", () => {
    for (const mode of ["standard", "advanced", "auto"] as const) {
      expect(buildExtractRequest(["https://example.com"], { mode }).mode).toBe(mode);
    }
  });

  it("rejects an unknown mode", () => {
    expect(() =>
      buildExtractRequest(["https://example.com"], { mode: "turbo" as any }),
    ).toThrow(/--mode must be one of: standard, advanced, auto/);
  });

  it("omits include_links unless --links or --max-links is given", () => {
    expect(buildExtractRequest(["https://example.com"], {})).not.toHaveProperty("include_links");
  });

  it("sends include_links {} for a bare --links", () => {
    const req = buildExtractRequest(["https://example.com"], { links: true });
    expect(req.include_links).toEqual({});
  });

  it("sends the scope for --links <scope>", () => {
    const req = buildExtractRequest(["https://example.com"], { links: "prefer_external" });
    expect(req.include_links).toEqual({ scope: "prefer_external" });
  });

  it("rejects an unknown link scope", () => {
    expect(() => buildExtractRequest(["https://example.com"], { links: "external" })).toThrow(
      /--links must be one of: prefer_internal, prefer_external/,
    );
  });

  it("lets --max-links alone imply include_links", () => {
    const req = buildExtractRequest(["https://example.com"], { maxLinks: 50 });
    expect(req.include_links).toEqual({ max_links: 50 });
  });

  it("combines scope and max_links", () => {
    const req = buildExtractRequest(["https://example.com"], { links: "prefer_internal", maxLinks: 5 });
    expect(req.include_links).toEqual({ scope: "prefer_internal", max_links: 5 });
  });

  it("validates maxLinks 1-1000 (the server 400s rather than clamping)", () => {
    expect(() => buildExtractRequest(["https://example.com"], { maxLinks: 0 })).toThrow(OctenValidationError);
    expect(() => buildExtractRequest(["https://example.com"], { maxLinks: 1001 })).toThrow(OctenValidationError);
    expect(() => buildExtractRequest(["https://example.com"], { maxLinks: 1 })).not.toThrow();
    expect(() => buildExtractRequest(["https://example.com"], { maxLinks: 1000 })).not.toThrow();
  });
});

describe("extractClientTimeoutMs", () => {
  it("defaults to the 30s server budget plus 90s headroom", () => {
    expect(extractClientTimeoutMs()).toBe(120_000);
  });

  it("adds headroom to the per-URL fetch timeout", () => {
    expect(extractClientTimeoutMs(10)).toBe(100_000);
  });

  it("reaches at most 150s at the largest valid --fetch-timeout (60)", () => {
    expect(extractClientTimeoutMs(60)).toBe(150_000);
  });
});
