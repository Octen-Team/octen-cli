import { describe, it, expect } from "vitest";
import { renderVideoSearch } from "../../../src/output/pretty/videoSearch.js";

// Primary fixture mirrors the REAL Octen API envelope: payload lives at data.data.
const fixture = {
  data: {
    results: [
      {
        title: "Espresso Guide",
        url: "https://a.com/v1",
        duration_seconds: 320,
        match_segment: { start_seconds: 30, end_seconds: 75 },
        authors: ["Barista Joe"],
        description: "how to pull a great shot",
      },
      {
        title: "Latte Art",
        url: "https://b.com/v2",
      },
    ],
  },
  code: 0,
  msg: "success",
  request_id: "req-1",
};

describe("renderVideoSearch", () => {
  it("unwraps the envelope and renders numbered results with title, url, duration, segment, authors, and snippet", () => {
    const out = renderVideoSearch(fixture);
    expect(out).toContain("1.");
    expect(out).toContain("Espresso Guide");
    expect(out).toContain("https://a.com/v1");
    expect(out).toContain("320s");
    expect(out).toContain("30");
    expect(out).toContain("75");
    expect(out).toContain("Barista Joe");
    expect(out).toContain("how to pull a great shot");
    expect(out).toContain("2.");
    expect(out).toContain("Latte Art");
  });

  it("handles empty results without crashing", () => {
    const out = renderVideoSearch({ data: { results: [] }, code: 0, msg: "success" });
    expect(typeof out).toBe("string");
    expect(out).toContain("No results");
  });

  it("surfaces an app-level API error (non-zero code) instead of 'No results.'", () => {
    const out = renderVideoSearch({ data: {}, code: 40001, msg: "invalid params" });
    expect(out).toContain("error");
    expect(out).toContain("invalid params");
  });
});
