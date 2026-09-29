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

  describe("mode, links, media and meta", () => {
    const links = Array.from({ length: 15 }, (_, i) => ({
      url: `https://example.com/p${i}`,
      anchor_text: `Page ${i}`,
      is_external: i === 0,
    }));
    const envelope = {
      data: {
        results: [
          {
            url: "https://example.com",
            status: "success",
            resolved_mode: "standard",
            title: "Example",
            page_structure: { primary: "Content Page" },
            images: [{ url: "https://example.com/a.png" }],
            videos: [{ url: "https://example.com/v.mp4" }],
            audio: [{ url: "https://example.com/s.mp3" }],
            links,
          },
          { url: "https://bad.example", status: "failed", error_message: "Failed to resolve domain" },
        ],
      },
      meta: {
        usage: { total_urls: 2, successful_urls: 1, successful_by_mode: { standard_urls: 1, advanced_urls: 0 } },
        warning: "1 URL(s) failed and were not billed",
      },
      code: 0,
      msg: "success",
    };

    it("shows resolved_mode for a successful item", () => {
      expect(renderExtract(envelope)).toContain("mode: standard");
    });

    it("does not show a mode line for a failed item", () => {
      const out = renderExtract({ data: { results: [envelope.data.results[1]] } });
      expect(out).not.toContain("mode:");
    });

    it("renders links capped at 10 with a remainder note", () => {
      const out = renderExtract(envelope);
      expect(out).toContain("links (15):");
      expect(out).toContain("https://example.com/p9");
      expect(out).not.toContain("https://example.com/p10");
      expect(out).toContain("5 more");
      expect(out).toContain("Page 0");
      expect(out).toContain("[external]");
    });

    it("renders all links with full=true", () => {
      const out = renderExtract(envelope, true);
      expect(out).toContain("https://example.com/p14");
      expect(out).not.toContain("more (--full");
    });

    it("renders images, videos and audio", () => {
      const out = renderExtract(envelope);
      expect(out).toContain("https://example.com/a.png");
      expect(out).toContain("https://example.com/v.mp4");
      expect(out).toContain("https://example.com/s.mp3");
    });

    it("adds a footer from top-level meta: counts, billing by mode and warning", () => {
      const out = renderExtract(envelope);
      expect(out).toContain("1/2 successful");
      expect(out).toContain("billed: 1 standard, 0 advanced");
      expect(out).toContain("warning: 1 URL(s) failed and were not billed");
    });

    it("omits the warning line when meta.warning is empty", () => {
      const out = renderExtract({ ...envelope, meta: { ...envelope.meta, warning: "" } });
      expect(out).not.toContain("warning:");
    });

    it("has no footer when meta is absent", () => {
      expect(renderExtract({ data: envelope.data })).not.toContain("billed:");
    });

    const skeletal = (resolved_mode: string) => ({
      data: {
        results: [
          { url: "https://spa.example", status: "success", resolved_mode, page_structure: { primary: "No Main Content" } },
        ],
      },
    });

    it("hints --mode advanced for a skeletal standard result", () => {
      expect(renderExtract(skeletal("standard"))).toContain("hint: retry with --mode advanced");
    });

    it("does not hint when the result already used advanced", () => {
      expect(renderExtract(skeletal("advanced"))).not.toContain("hint:");
    });

    it("does not hint when advanced was already requested", () => {
      expect(renderExtract(skeletal("standard"), false, "advanced")).not.toContain("hint:");
    });

    const failed = { data: { results: [{ url: "https://hard.example", status: "failed", error_message: "blocked" }] } };

    it("hints --mode advanced for a failed result when advanced was not requested", () => {
      expect(renderExtract(failed)).toContain("hint: retry with --mode advanced");
      expect(renderExtract(failed, false, "auto")).toContain("hint: retry with --mode advanced");
    });

    it("does not hint for a failed result when advanced was already requested", () => {
      expect(renderExtract(failed, false, "advanced")).not.toContain("hint:");
    });

    it("does not hint for ordinary page structures", () => {
      const ok = { data: { results: [envelope.data.results[0]] } };
      expect(renderExtract(ok)).not.toContain("hint:");
    });
  });
});
