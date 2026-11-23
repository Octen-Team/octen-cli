import { describe, it, expect } from "vitest";
import { formatResultList, renderSearch } from "../../../src/output/pretty/search.js";

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

// formatResultList is shared: search, broad-search, premier, place and design
// all print their web results through it.
describe("renderSearch with a malformed or hostile response", () => {
  const ESC = "\u001b";

  it("skips an entry that is not an object and keeps the ones beside it", () => {
    const out = renderSearch({ code: 0, data: { results: [null, "x", { title: "Kept", url: "https://k.test" }, 7] } });
    expect(out).toContain("1. ");
    expect(out).toContain("Kept");
    expect(out).not.toContain("2. ");
  });

  it("treats results that are not a list as no results", () => {
    expect(renderSearch({ code: 0, data: { results: "nope" } })).toContain("No results");
    expect(renderSearch({ code: 0, data: { results: { a: 1 } } })).toContain("No results");
  });

  it("says no results when every entry was malformed", () => {
    expect(renderSearch({ code: 0, data: { results: [null, 3] } })).toContain("No results");
  });

  it("shows an escape sequence in a result instead of sending it to the terminal", () => {
    const out = renderSearch({
      code: 0,
      data: { results: [{ title: `T${ESC}[2J`, url: `https://a.test/${ESC}[H`, time_published: `2024${ESC}[1A`, highlight: `one\rtwo${ESC}[31m` }] },
    });
    expect(out).not.toContain(ESC);
    expect(out).not.toContain("\r");
    expect(out).toContain("T\\x1b[2J");
    expect(out).toContain("one\ntwo\\x1b[31m");
  });

  // The API sends an empty string for a field that is switched off, so "no
  // highlight" arrives as "" rather than as a missing key.
  it("falls back to the full content when the highlight is empty", () => {
    const out = renderSearch({ code: 0, data: { results: [{ title: "T", highlight: "", full_content: "the paid-for body" }] } });
    expect(out).toContain("the paid-for body");
  });

  it("ignores a field of the wrong type instead of printing or crashing on it", () => {
    const out = renderSearch({ code: 0, data: { results: [{ title: { a: 1 }, url: 5, highlight: ["x"], time_published: {} }] } });
    expect(out).toContain("1. ");
    expect(out).toContain("(no title)");
    expect(out).not.toContain("[object Object]");
  });
});

// Called directly by the renderers that do not filter their own list first
// (broad-search, place), so it has to cope on its own.
describe("formatResultList", () => {
  it("skips entries that are not objects and numbers the rest from one", () => {
    const out = formatResultList([null, "x", { title: "Kept" }, 7, { title: "Also kept" }]);
    expect(out).toContain("1. ");
    expect(out).toContain("Kept");
    expect(out).toContain("2. ");
    expect(out).toContain("Also kept");
    expect(out).not.toContain("3. ");
  });

  it("returns nothing for a value that is not a list", () => {
    expect(formatResultList("nope")).toBe("");
    expect(formatResultList(undefined)).toBe("");
    expect(formatResultList({ 0: { title: "T" }, length: 1 })).toBe("");
  });
});
