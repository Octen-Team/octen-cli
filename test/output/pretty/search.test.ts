import { describe, it, expect } from "vitest";
import { renderSearch } from "../../../src/output/pretty/search.js";

// Primary fixture mirrors the REAL Octen API envelope: payload lives at data.data.
const fixture = {
  data: {
    query: "q",
    results: [
      { title: "T1", url: "https://a.com", highlight: "snippet one" },
      { title: "T2", url: "https://b.com", full_content: "body two" },
    ],
  },
  code: 0,
  msg: "success",
  request_id: "req-1",
};

describe("renderSearch", () => {
  it("unwraps the envelope and renders numbered results with title, url, and snippet", () => {
    const out = renderSearch(fixture);
    expect(out).toContain("1.");
    expect(out).toContain("T1");
    expect(out).toContain("https://a.com");
    expect(out).toContain("snippet one");
    expect(out).toContain("2.");
    expect(out).toContain("T2");
    expect(out).toContain("https://b.com");
  });

  it("falls back to full_content when highlight is absent", () => {
    const out = renderSearch(fixture);
    expect(out).toContain("body two");
  });

  it("still renders an un-enveloped (top-level results) response via the ?? data fallback", () => {
    const out = renderSearch({
      results: [{ title: "Flat", url: "https://flat.com", highlight: "flat snippet" }],
    });
    expect(out).toContain("Flat");
    expect(out).toContain("https://flat.com");
    expect(out).toContain("flat snippet");
  });

  it("handles empty results without crashing", () => {
    const out = renderSearch({ data: { results: [] }, code: 0, msg: "success" });
    expect(typeof out).toBe("string");
    expect(out).toContain("No results");
  });

  it("handles missing results field without crashing", () => {
    const out = renderSearch({});
    expect(typeof out).toBe("string");
    expect(out).toContain("No results");
  });

  it("surfaces an app-level API error (non-zero code) instead of 'No results.'", () => {
    const out = renderSearch({ data: {}, code: 40001, msg: "invalid params" });
    expect(out).toContain("error");
    expect(out).toContain("invalid params");
  });
});
