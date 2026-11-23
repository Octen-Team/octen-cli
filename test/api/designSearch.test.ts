import { describe, it, expect } from "vitest";
import { buildDesignSearchRequest } from "../../src/api/designSearch.js";
import { OctenValidationError } from "../../src/api/errors.js";

describe("buildDesignSearchRequest", () => {
  it("includes only provided fields", () => {
    expect(buildDesignSearchRequest("saas pricing page", {})).toEqual({ query: "saas pricing page" });
  });

  it("sends the query as typed", () => {
    expect(buildDesignSearchRequest(" hero  section ", {})).toEqual({ query: " hero  section " });
  });

  describe("image options", () => {
    it("nests count under images", () => {
      expect(buildDesignSearchRequest("q", { count: 12 })).toEqual({ query: "q", images: { count: 12 } });
    });

    it("turns the design values off without pinning anything else", () => {
      expect(buildDesignSearchRequest("q", { noDesignFacts: true })).toEqual({
        query: "q",
        images: { design_facts: false },
      });
    });

    it("turns the code off", () => {
      expect(buildDesignSearchRequest("q", { noSnippet: true })).toEqual({
        query: "q",
        images: { snippet: { enable: false } },
      });
    });

    // Measured against the API: a cap sent on its own is honoured, so the
    // builder does not have to pin `enable` to send it.
    it("sends a code cap on its own", () => {
      expect(buildDesignSearchRequest("q", { snippetMaxTokens: 800 })).toEqual({
        query: "q",
        images: { snippet: { max_tokens: 800 } },
      });
    });

    it("switches the design references off", () => {
      expect(buildDesignSearchRequest("q", { noImages: true })).toEqual({
        query: "q",
        images: { enable: false },
      });
    });

    it("rejects a count or a code cap outside the documented range", () => {
      expect(() => buildDesignSearchRequest("q", { count: 0 })).toThrow(OctenValidationError);
      expect(() => buildDesignSearchRequest("q", { count: 101 })).toThrow(OctenValidationError);
      expect(buildDesignSearchRequest("q", { count: 100 })).toMatchObject({ images: { count: 100 } });
      expect(() => buildDesignSearchRequest("q", { snippetMaxTokens: 99 })).toThrow(OctenValidationError);
      expect(() => buildDesignSearchRequest("q", { snippetMaxTokens: 100_001 })).toThrow(OctenValidationError);
    });
  });

  describe("group lookup", () => {
    it("needs no query", () => {
      expect(buildDesignSearchRequest("", { group: "deck_abc", count: 28 })).toEqual({
        images: { count: 28, group_id: "deck_abc" },
      });
    });

    it("drops a query of only whitespace instead of sending it", () => {
      expect(buildDesignSearchRequest("   ", { group: "deck_abc" })).toEqual({ images: { group_id: "deck_abc" } });
    });

    it("keeps a real query beside the group — it drives the web results", () => {
      expect(buildDesignSearchRequest("team slide", { group: "deck_abc" })).toEqual({
        query: "team slide",
        images: { group_id: "deck_abc" },
      });
    });

    it("trims the id, so the id that was checked is the id that is sent", () => {
      expect(buildDesignSearchRequest("", { group: "  deck_abc\n" })).toEqual({ images: { group_id: "deck_abc" } });
    });

    it("refuses an empty id", () => {
      expect(() => buildDesignSearchRequest("q", { group: "   " })).toThrow(/--group/);
      expect(() => buildDesignSearchRequest("q", { group: "" })).toThrow(OctenValidationError);
    });

    // The API does not raise the default of five for a group, and the builder
    // does not either: the count is the caller's to give.
    it("does not invent a count for the group", () => {
      const req = buildDesignSearchRequest("", { group: "deck_abc" });
      expect(req.images).not.toHaveProperty("count");
    });
  });

  describe("refusals made before any request", () => {
    it("neither a query nor a group", () => {
      expect(() => buildDesignSearchRequest("", {})).toThrow(OctenValidationError);
      expect(() => buildDesignSearchRequest("   ", {})).toThrow(/--group/);
    });

    it("a group with the images switched off", () => {
      expect(() => buildDesignSearchRequest("", { group: "deck_abc", noImages: true })).toThrow(OctenValidationError);
      expect(() => buildDesignSearchRequest("q", { group: "deck_abc", noImages: true })).toThrow(/--no-images/);
    });

    // Measured against the API: this is answered with an empty success that
    // still counts as a search.
    it("both result groups switched off", () => {
      expect(() => buildDesignSearchRequest("q", { noImages: true, noWeb: true })).toThrow(OctenValidationError);
      expect(() => buildDesignSearchRequest("q", { noImages: true, noWeb: true })).toThrow(/nothing/);
    });
  });

  describe("web options", () => {
    it("nests every web option under web_search", () => {
      expect(
        buildDesignSearchRequest("q", {
          webCount: 3,
          includeDomains: ["a.com"],
          excludeDomains: ["b.com"],
          language: ["en"],
          timeBasis: "published",
          timeRange: "month",
          startTime: "2024-01-01",
          endTime: "2024-01-31",
          highlight: true,
          highlightMaxTokens: 300,
          fullContent: true,
          fullContentMaxTokens: 1000,
        }),
      ).toEqual({
        query: "q",
        web_search: {
          count: 3,
          include_domains: ["a.com"],
          exclude_domains: ["b.com"],
          language: ["en"],
          time_basis: "published",
          time_range: "month",
          start_time: "2024-01-01T00:00:00Z",
          end_time: "2024-01-31T23:59:59Z",
          highlight: { enable: true, max_tokens: 300 },
          full_content: { enable: true, max_tokens: 1000 },
        },
      });
    });

    it("keeps the web options out of the top level and out of images", () => {
      const req = buildDesignSearchRequest("q", { webCount: 3, includeDomains: ["a.com"], count: 2 });
      expect(Object.keys(req).sort()).toEqual(["images", "query", "web_search"]);
      expect(req.images).toEqual({ count: 2 });
    });

    it("switches the web results off", () => {
      expect(buildDesignSearchRequest("q", { noWeb: true })).toEqual({ query: "q", web_search: { enable: false } });
    });

    // Highlights are on unless switched off, so a cap alone is a complete
    // request — measured: the API honours it without `enable`.
    it("sends a highlight cap on its own", () => {
      expect(buildDesignSearchRequest("q", { highlightMaxTokens: 200 })).toEqual({
        query: "q",
        web_search: { highlight: { max_tokens: 200 } },
      });
    });

    // Full content is off unless asked for, and measured: a cap alone returns
    // none. Dropping the cap would hide that; enabling a billed option from a
    // flag that did not name it would be worse.
    it("refuses a full-content cap without --full-content", () => {
      expect(() => buildDesignSearchRequest("q", { fullContentMaxTokens: 500 })).toThrow(OctenValidationError);
      expect(() => buildDesignSearchRequest("q", { fullContentMaxTokens: 500 })).toThrow(/--full-content/);
    });

    it("rejects web values outside their documented range", () => {
      expect(() => buildDesignSearchRequest("q", { webCount: 0 })).toThrow(OctenValidationError);
      expect(() => buildDesignSearchRequest("q", { webCount: 101 })).toThrow(OctenValidationError);
      expect(() => buildDesignSearchRequest("q", { highlightMaxTokens: 99 })).toThrow(OctenValidationError);
      expect(() => buildDesignSearchRequest("q", { fullContent: true, fullContentMaxTokens: 100_001 }))
        .toThrow(OctenValidationError);
      expect(() => buildDesignSearchRequest("q", { timeRange: "decade" })).toThrow(/--time-range/);
      expect(() => buildDesignSearchRequest("q", { timeBasis: "edited" as never })).toThrow(/--time-basis/);
      expect(() => buildDesignSearchRequest("q", { startTime: "yesterday" })).toThrow(/--start-time/);
    });
  });

  // An option for a group that was switched off does nothing at the API. The
  // usual reason to type one is believing it applies to the other group —
  // `--include-domains` to the screenshots, `-n` to the web results.
  describe("an option for a group that is switched off", () => {
    const webOnly: Array<[string, Record<string, unknown>]> = [
      ["--web-count", { webCount: 3 }],
      ["--include-domains", { includeDomains: ["a.com"] }],
      ["--exclude-domains", { excludeDomains: ["a.com"] }],
      ["--language", { language: ["en"] }],
      ["--time-basis", { timeBasis: "published" }],
      ["--time-range", { timeRange: "week" }],
      ["--start-time", { startTime: "2024-01-01" }],
      ["--end-time", { endTime: "2024-01-31" }],
      ["--highlight", { highlight: true }],
      ["--highlight-max-tokens", { highlightMaxTokens: 300 }],
      ["--full-content", { fullContent: true }],
    ];
    for (const [flag, opts] of webOnly) {
      it(`${flag} is refused with --no-web`, () => {
        const build = () => buildDesignSearchRequest("q", { noWeb: true, ...opts });
        expect(build).toThrow(OctenValidationError);
        expect(build).toThrow(flag);
        expect(build).toThrow(/--no-web/);
      });
    }

    const imageOnly: Array<[string, Record<string, unknown>]> = [
      ["--count", { count: 3 }],
      ["--no-design-facts", { noDesignFacts: true }],
      ["--no-snippet", { noSnippet: true }],
      ["--snippet-max-tokens", { snippetMaxTokens: 800 }],
    ];
    for (const [flag, opts] of imageOnly) {
      it(`${flag} is refused with --no-images`, () => {
        const build = () => buildDesignSearchRequest("q", { noImages: true, ...opts });
        expect(build).toThrow(OctenValidationError);
        expect(build).toThrow(flag);
        expect(build).toThrow(/--no-images/);
      });
    }

    it("a code cap is refused with --no-snippet", () => {
      const build = () => buildDesignSearchRequest("q", { noSnippet: true, snippetMaxTokens: 800 });
      expect(build).toThrow(OctenValidationError);
      expect(build).toThrow(/--no-snippet/);
    });

    it("the same options pass when their group is on", () => {
      expect(buildDesignSearchRequest("q", { noWeb: true, count: 3, noSnippet: true })).toEqual({
        query: "q",
        images: { count: 3, snippet: { enable: false } },
        web_search: { enable: false },
      });
      expect(buildDesignSearchRequest("q", { noImages: true, webCount: 3 })).toEqual({
        query: "q",
        images: { enable: false },
        web_search: { count: 3 },
      });
    });
  });
});
