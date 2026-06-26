import { describe, it, expect } from "vitest";
import { renderExtract } from "../../../src/output/pretty/extract.js";

// Primary fixture mirrors the REAL Octen API envelope: results live at data.results.
const fixture = {
  data: {
    results: [
      {
        url: "https://example.com/article",
        status: "success",
        title: "Example Article",
        category: { primary: "Technology", secondary: "AI" },
        page_structure: { primary: "article", secondary: "blog" },
        time_last_crawled: "2024-01-01",
        highlights: ["This is a key highlight from the article."],
      },
      {
        url: "https://broken.com/page",
        status: "failed",
        error_message: "Connection timed out",
      },
    ],
  },
  code: 0,
  msg: "success",
  request_id: "req-1",
};

describe("renderExtract", () => {
  it("renders the URL for a success item", () => {
    const out = renderExtract(fixture);
    expect(out).toContain("https://example.com/article");
  });

  it("renders the title for a success item", () => {
    const out = renderExtract(fixture);
    expect(out).toContain("Example Article");
  });

  it("renders category and page_structure info for a success item", () => {
    const out = renderExtract(fixture);
    expect(out).toContain("Technology");
    expect(out).toContain("article");
  });

  it("renders highlights when present", () => {
    const out = renderExtract(fixture);
    expect(out).toContain("This is a key highlight from the article.");
  });

  it("renders the URL for a failed item", () => {
    const out = renderExtract(fixture);
    expect(out).toContain("https://broken.com/page");
  });

  it("renders the error_message for a failed item", () => {
    const out = renderExtract(fixture);
    expect(out).toContain("Connection timed out");
  });

  it("handles empty results array", () => {
    const out = renderExtract({ data: { results: [] }, code: 0, msg: "success" });
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });

  it("handles missing items/results field", () => {
    const out = renderExtract({});
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });

  it("still renders an un-enveloped (top-level items) response via the ?? data fallback", () => {
    const data = {
      items: [
        {
          url: "https://results.com",
          status: "success",
          title: "Results Page",
          full_content: "Some content here from full_content field.",
        },
      ],
    };
    const out = renderExtract(data);
    expect(out).toContain("https://results.com");
    expect(out).toContain("Results Page");
    expect(out).toContain("Some content here from full_content field.");
  });

  it("surfaces an app-level API error (non-zero code) instead of 'No results.'", () => {
    const out = renderExtract({ data: {}, code: 40001, msg: "invalid url" });
    expect(out).toContain("error");
    expect(out).toContain("invalid url");
  });

  it("truncates long full_content to ~500 chars when no highlights", () => {
    const longContent = "A".repeat(1000);
    const data = {
      data: {
        results: [
          {
            url: "https://long.com",
            status: "success",
            title: "Long Article",
            full_content: longContent,
          },
        ],
      },
    };
    const out = renderExtract(data);
    // Should be truncated, not full 1000 chars
    expect(out.length).toBeLessThan(900);
  });

  it("prints full content untruncated when full=true", () => {
    const longContent = "A".repeat(1000);
    const data = {
      data: {
        results: [
          {
            url: "https://long.com",
            status: "success",
            title: "Long Article",
            full_content: longContent,
          },
        ],
      },
    };
    const out = renderExtract(data, true);
    // The complete 1000-char body is present and not ellipsized.
    expect(out).toContain(longContent);
    expect(out).not.toContain("…");
  });
});
