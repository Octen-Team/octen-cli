import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { registerDesignSearch } from "../../src/commands/designSearch.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function makeProgram() {
  const prog = new Command();
  prog.name("octen")
    .option("--api-key <key>", "Octen API key")
    .option("--base-url <url>", "API base URL")
    .option("--json", "raw JSON output")
    .option("--pretty", "human-readable output")
    .exitOverride()
    .configureOutput({ writeErr: () => {} });
  registerDesignSearch(prog);
  return prog;
}

const slide = (position: number, total: number) => ({
  type: "slide",
  title: `Slide ${position}`,
  url: `https://img.test/${position}.png`,
  group: { group_id: "deck_abc", type: "deck", name: "A deck", position, total },
});

describe("design command", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let reply: unknown;

  beforeEach(() => {
    reply = {
      code: 0,
      msg: "success",
      request_id: "req-1",
      data: { images: [{ type: "web_page", title: "A page design", url: "https://img.test/a.png" }], results: [] },
    };
    // A Response body reads once, so each call needs its own.
    fetchSpy = vi.spyOn(globalThis, "fetch" as any).mockImplementation(
      () => Promise.resolve(jsonResponse(reply)) as any,
    );
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const path = () => new URL(String(fetchSpy.mock.calls[0]?.[0])).pathname;
  const body = () => JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as any)?.body));
  const written = () => writeSpy.mock.calls.map((c) => String(c[0])).join("");
  const run = (...argv: string[]) =>
    makeProgram().parseAsync(["node", "octen", "design-search", ...argv, "--api-key", "k"]);

  it("posts the query to /design-search and nothing else", async () => {
    await run("saas", "pricing", "page", "--json");
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(path()).toBe("/design-search");
    // commander gives every `--no-x` option a default of true. None of those
    // defaults may reach the request: an option is sent only when it was typed.
    expect(body()).toEqual({ query: "saas pricing page" });
  });

  it("nests the image options under images", async () => {
    await run("hero", "--json", "-n", "12", "--no-design-facts", "--snippet-max-tokens", "800");
    expect(body()).toEqual({
      query: "hero",
      images: { count: 12, design_facts: false, snippet: { enable: true, max_tokens: 800 } },
    });
  });

  it("--no-snippet switches the code off", async () => {
    await run("hero", "--json", "--no-snippet");
    expect(body()).toEqual({ query: "hero", images: { snippet: { enable: false } } });
  });

  it("--no-web returns design references only", async () => {
    await run("hero", "--json", "--no-web");
    expect(body()).toEqual({ query: "hero", web_search: { enable: false } });
  });

  it("--no-images returns web results only", async () => {
    await run("hero", "--json", "--no-images", "--web-count", "3");
    expect(body()).toEqual({ query: "hero", images: { enable: false }, web_search: { count: 3 } });
  });

  it("nests the web options under web_search", async () => {
    await run(
      "hero", "--json", "--web-count", "3",
      "--include-domains", "a.com, b.com", "--exclude-domains", "c.com", "--language", "en,ja",
      "--time-basis", "published", "--time-range", "month",
      "--highlight-max-tokens", "200", "--full-content", "--full-content-max-tokens", "1000",
    );
    expect(body()).toEqual({
      query: "hero",
      web_search: {
        count: 3,
        include_domains: ["a.com", "b.com"],
        exclude_domains: ["c.com"],
        language: ["en", "ja"],
        time_basis: "published",
        time_range: "month",
        highlight: { enable: true, max_tokens: 200 },
        full_content: { enable: true, max_tokens: 1000 },
      },
    });
  });

  it("expands bare dates in --start-time and --end-time", async () => {
    await run("hero", "--json", "--start-time", "2024-01-01", "--end-time", "2024-01-31");
    expect(body().web_search).toEqual({ start_time: "2024-01-01T00:00:00Z", end_time: "2024-01-31T23:59:59Z" });
  });

  describe("group lookup", () => {
    it("needs no query", async () => {
      await run("--group", "deck_abc", "-n", "28", "--json");
      expect(body()).toEqual({ images: { count: 28, group_id: "deck_abc" } });
    });

    it("sends a query beside the group when one is given", async () => {
      await run("team", "slide", "--group", "deck_abc", "--json");
      expect(body()).toEqual({ query: "team slide", images: { group_id: "deck_abc" } });
    });

    it("tells the pretty output it was a lookup, so a partial group says so", async () => {
      reply = { code: 0, msg: "success", request_id: "r", data: { images: [slide(1, 28), slide(2, 28)] } };
      await run("--group", " deck_abc ", "--pretty");
      expect(written()).toContain("Showing 2 of 28");
      expect(written()).not.toContain("Whole deck:");
    });

    it("passes --base-url on to the command it prints", async () => {
      reply = { code: 0, msg: "success", request_id: "r", data: { images: [slide(3, 28)] } };
      await run("pitch deck", "--pretty", "--base-url", "http://127.0.0.1:9");
      expect(written()).toContain("octen design-search --group deck_abc -n 28 --base-url http://127.0.0.1:9");
    });

    it("an ordinary search prints how to fetch the whole group instead", async () => {
      reply = { code: 0, msg: "success", request_id: "r", data: { images: [slide(3, 28)] } };
      await run("pitch deck", "--pretty");
      expect(written()).toContain("Whole deck: octen design-search --group deck_abc -n 28");
      expect(written()).not.toContain("Showing");
    });

    // The id printed is the id that was sent — trimmed — not the flag as typed.
    it("names the id when the group has no images", async () => {
      reply = { code: 0, msg: "success", request_id: "r", data: { images: [], results: [] } };
      await run("--group", " deck_nope ", "--pretty");
      expect(body().images.group_id).toBe("deck_nope");
      expect(written()).toContain("No images in group deck_nope.");
    });
  });

  describe("refused before any request", () => {
    const refused: Array<[string, string[], RegExp]> = [
      ["neither a query nor a group", [], /give a query, or --group/],
      ["a query of only whitespace", ["  "], /give a query, or --group/],
      ["a group with --no-images", ["--group", "deck_abc", "--no-images"], /cannot be combined with --no-images/],
      ["both groups off", ["hero", "--no-images", "--no-web"], /leave nothing to return/],
      ["an empty --group", ["hero", "--group", " "], /--group must not be empty/],
      ["a web option with --no-web", ["hero", "--no-web", "--include-domains", "a.com"], /--include-domains applies to the web results/],
      ["an image option with --no-images", ["hero", "--no-images", "-n", "3"], /--count applies to the design references/],
      ["a code cap with --no-snippet", ["hero", "--no-snippet", "--snippet-max-tokens", "800"], /--no-snippet/],
      ["a full-content cap alone", ["hero", "--full-content-max-tokens", "500"], /needs --full-content/],
      ["a web option on a group lookup with no query", ["--group", "deck_abc", "--web-count", "3"], /--web-count applies to the web results, which need a query/],
      ["a count out of range", ["hero", "-n", "101"], /count must be 1-100/],
      ["a count that is not an integer", ["hero", "-n", "1.5"], /--count must be an integer/],
      ["an empty domain list", ["hero", "--include-domains", ""], /--include-domains must contain at least one/],
      ["an unknown time range", ["hero", "--time-range", "decade"], /--time-range must be one of/],
    ];
    for (const [what, argv, message] of refused) {
      it(what, async () => {
        await expect(run(...argv)).rejects.toThrow(message);
        expect(fetchSpy).not.toHaveBeenCalled();
      });
    }
  });

  it("prints the raw envelope with --json", async () => {
    await run("hero", "--json");
    expect(JSON.parse(written())).toEqual(reply);
  });

  it("prints the design references with --pretty", async () => {
    await run("hero", "--pretty");
    expect(written()).toContain("A page design");
    expect(written()).toContain("https://img.test/a.png");
  });
});
