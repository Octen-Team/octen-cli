import { describe, it, expect } from "vitest";
import { renderImageSearch } from "../../../src/output/pretty/imageSearch.js";

// Primary fixture mirrors the REAL Octen API envelope: payload lives at data.data.
const fixture = {
  data: {
    results: [
      {
        title: "Red Car",
        url: "https://a.com/red.jpg",
        source_page: "https://a.com/page",
        width: 800,
        height: 600,
        description: "a shiny red car",
      },
      {
        title: "Blue Car",
        url: "https://b.com/blue.jpg",
        summary: "a calm blue car",
      },
    ],
  },
  code: 0,
  msg: "success",
  request_id: "req-1",
};

describe("renderImageSearch", () => {
  it("unwraps the envelope and renders numbered results with title, url, dimensions, and snippet", () => {
    const out = renderImageSearch(fixture);
    expect(out).toContain("1.");
    expect(out).toContain("Red Car");
    expect(out).toContain("https://a.com/red.jpg");
    expect(out).toContain("https://a.com/page");
    expect(out).toContain("800x600");
    expect(out).toContain("a shiny red car");
    expect(out).toContain("2.");
    expect(out).toContain("Blue Car");
  });

  it("falls back to summary when description is absent", () => {
    const out = renderImageSearch(fixture);
    expect(out).toContain("a calm blue car");
  });

  it("handles empty results without crashing", () => {
    const out = renderImageSearch({ data: { results: [] }, code: 0, msg: "success" });
    expect(typeof out).toBe("string");
    expect(out).toContain("No results");
  });

  it("surfaces an app-level API error (non-zero code) instead of 'No results.'", () => {
    const out = renderImageSearch({ data: {}, code: 40001, msg: "invalid params" });
    expect(out).toContain("error");
    expect(out).toContain("invalid params");
  });
});
