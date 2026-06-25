import { describe, it, expect } from "vitest";
import { renderSearch } from "../../../src/output/pretty/search.js";

const fixture = {
  results: [
    { title: "T1", url: "https://a.com", highlight: "snippet one" },
    { title: "T2", url: "https://b.com", full_content: "body two" },
  ],
};

describe("renderSearch", () => {
  it("renders numbered results with title, url, and snippet", () => {
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

  it("handles empty results without crashing", () => {
    const out = renderSearch({ results: [] });
    expect(typeof out).toBe("string");
    expect(out).toContain("No results");
  });

  it("handles missing results field without crashing", () => {
    const out = renderSearch({});
    expect(typeof out).toBe("string");
    expect(out).toContain("No results");
  });
});
