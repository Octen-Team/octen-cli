import { describe, it, expect } from "vitest";
import { renderNewsSearch } from "../../src/output/pretty/newsSearch.js";
import { renderBusinessSearch } from "../../src/output/pretty/businessSearch.js";
import { renderPlaceSearch } from "../../src/output/pretty/placeSearch.js";
import { renderPulseSearch, withScheme } from "../../src/output/pretty/pulseSearch.js";

const env = (data: unknown) => ({ code: 0, msg: "success", data });

/**
 * These all guard one rule: nothing the caller asked for, or was billed for,
 * may be dropped on the way to the terminal. Every field here was returned by
 * the live API and silently discarded by the first version of its renderer.
 */
describe("news renderer", () => {
  it("keeps the content on storyline articles", () => {
    // A storyline's articles need not appear in `results`, so content dropped
    // here has nowhere else to surface.
    const out = renderNewsSearch(env({
      subjects: [{
        name: "A storyline",
        summary: "What it amounts to.",
        top_news: { title: "Lead", url: "https://a.test/1", highlight: "the paid-for highlight" },
        sub_news: [{ title: "Supporting", url: "https://a.test/2", summary: "its summary" }],
      }],
      results: [],
    }));
    expect(out).toContain("the paid-for highlight");
    expect(out).toContain("its summary");
  });

  it("prints an API error instead of 'No results'", () => {
    expect(renderNewsSearch({ code: 401, msg: "unauthorized", data: {} })).toContain("unauthorized");
  });
});

describe("business renderer", () => {
  // The two fixtures say different things on purpose: when current_position
  // echoed the career entry, dropping its rendering left both assertions
  // passing, so the test could not fail for the bug it exists to catch.
  it("renders a person's current position", () => {
    const out = renderBusinessSearch(env({
      entities: [{
        name: "A Person",
        type: "person",
        current_position: "Chair & CEO at ACME",
        career: [{ organization: "Previous Co", title: "VP Engineering", start: "2015", end: "2022" }],
      }],
    }));
    expect(out).toContain("Chair & CEO at ACME");
  });

  it("renders career history, and does not call an ended role current", () => {
    const out = renderBusinessSearch(env({
      entities: [{
        name: "A Person",
        type: "person",
        career: [
          { organization: "ACME", title: "Chair & CEO", start: "February 2022" },
          { organization: "Previous Co", title: "VP Engineering", start: "2015", end: "2022" },
        ],
      }],
    }));
    expect(out).toContain("Chair & CEO at ACME (February 2022 – present)");
    expect(out).toContain("VP Engineering at Previous Co (2015 – 2022)");
    expect(out).not.toContain("VP Engineering at Previous Co (2015 – present)");
  });

  it("renders activities — otherwise --max-activities does nothing visible", () => {
    const out = renderBusinessSearch(env({
      entities: [{ name: "ACME", activities: [{ title: "An announcement", url: "https://a.test/x" }] }],
    }));
    expect(out).toContain("An announcement");
  });

  it("keeps the highlight on entity news", () => {
    const out = renderBusinessSearch(env({
      entities: [{ name: "ACME", news: [{ title: "A headline", highlight: "billed content" }] }],
    }));
    expect(out).toContain("billed content");
  });

  it("says how many series entries were left out", () => {
    const funding = Array.from({ length: 10 }, (_, i) => ({ round: "Series A", amount: 1e9, date: `202${i}-01-01` }));
    expect(renderBusinessSearch(env({ entities: [{ name: "ACME", metrics: { funding } }] })))
      .toContain("+6 earlier rounds");
  });
});

describe("place renderer", () => {
  it("reads data.places, not data.results", () => {
    // `results` is where the optional web pages go; reading it concludes the
    // endpoint returned nothing.
    expect(renderPlaceSearch(env({ places: [{ name: "A Cafe" }], results: [] }))).toContain("A Cafe");
  });

  it("renders coordinates and attributes, including a false one", () => {
    const out = renderPlaceSearch(env({
      places: [{
        name: "A Cafe",
        latitude: 35.68,
        longitude: 139.76,
        attributes: { wifi: true, wheelchair_accessible: false },
      }],
    }));
    expect(out).toContain("35.68, 139.76");
    expect(out).toContain("wifi");
    // A definite no must not read the same as an unknown.
    expect(out).toContain("no wheelchair_accessible");
  });

  it("renders review excerpts when they were asked for", () => {
    const out = renderPlaceSearch(env({
      places: [{ name: "A Cafe", reviews: [{ text: "Worth the queue.", rating: 5, time_published: "2 months ago" }] }],
    }));
    expect(out).toContain("5/5");
    expect(out).toContain("Worth the queue.");
  });
});

describe("pulse renderer", () => {
  it("puts a scheme back on lite-mode URLs", () => {
    // The API returns `docs.astral.sh/uv` in lite mode — openable by nothing.
    expect(withScheme("docs.astral.sh/uv")).toBe("https://docs.astral.sh/uv");
  });

  it("leaves a URL that already has one alone", () => {
    expect(withScheme("https://a.test/x")).toBe("https://a.test/x");
    expect(withScheme("http://a.test/x")).toBe("http://a.test/x");
  });

  it("adds only the scheme to a protocol-relative URL", () => {
    expect(withScheme("//a.test/x")).toBe("https://a.test/x");
  });

  it("passes through a non-string unchanged", () => {
    expect(withScheme(undefined)).toBe(undefined);
    expect(withScheme("")).toBe("");
  });

  it("renders results with the scheme applied", () => {
    expect(renderPulseSearch(env({ results: [{ title: "uv", url: "docs.astral.sh/uv" }] })))
      .toContain("https://docs.astral.sh/uv");
  });
});
