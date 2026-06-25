import { describe, it, expect } from "vitest";
import { renderExtract } from "../../../src/output/pretty/extract.js";

const fixture = {
  items: [
    {
      url: "https://example.com/article",
      status: "success",
      title: "Example Article",
      category: { primary: "Technology", secondary: "AI" },
      page_structure: { primary: "article", secondary: "blog" },
      time_published: "2024-01-01",
      highlights: ["This is a key highlight from the article."],
    },
    {
      url: "https://broken.com/page",
      status: "failed",
      error_message: "Connection timed out",
    },
  ],
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

  it("handles empty items array", () => {
    const out = renderExtract({ items: [] });
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });

  it("handles missing items/results field", () => {
    const out = renderExtract({});
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });

  it("falls back to results array if items is absent", () => {
    const data = {
      results: [
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

  it("truncates long full_content to ~500 chars when no highlights", () => {
    const longContent = "A".repeat(1000);
    const data = {
      items: [
        {
          url: "https://long.com",
          status: "success",
          title: "Long Article",
          full_content: longContent,
        },
      ],
    };
    const out = renderExtract(data);
    // Should be truncated, not full 1000 chars
    expect(out.length).toBeLessThan(900);
  });
});
