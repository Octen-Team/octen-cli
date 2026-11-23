import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { registerPremierSearch } from "../../src/commands/premierSearch.js";
import { registerSearch } from "../../src/commands/search.js";

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
    // commander prints its own usage errors; keep them out of the test output.
    .configureOutput({ writeErr: () => {} });
  registerSearch(prog);
  registerPremierSearch(prog);
  return prog;
}

const flags = (prog: Command, name: string) =>
  prog.commands.find((c) => c.name() === name)!.options.map((o) => o.long).sort();

describe("premier command", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch" as any).mockImplementation(
      () => Promise.resolve(jsonResponse({
        code: 0,
        msg: "success",
        request_id: "req-1",
        data: { results: [{ title: "A result", url: "https://a.test/x", highlight: "its highlight" }] },
      })) as any,
    );
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const path = () => new URL(String(fetchSpy.mock.calls[0]?.[0])).pathname;
  const body = () => JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as any)?.body));
  const written = () => writeSpy.mock.calls.map((c) => String(c[0])).join("");

  it("posts to /search-premier, not /search", async () => {
    await makeProgram().parseAsync(["node", "octen", "premier", "hi", "--json", "--api-key", "k"]);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(path()).toBe("/search-premier");
    expect(body()).toEqual({ query: "hi" });
  });

  it("joins an unquoted multi-word query", async () => {
    await makeProgram().parseAsync(["node", "octen", "premier", "rust", "async", "runtime", "--json", "--api-key", "k"]);
    expect(body()).toEqual({ query: "rust async runtime" });
  });

  it("sends --result-type as result_type", async () => {
    await makeProgram().parseAsync(["node", "octen", "premier", "hi", "--json", "--api-key", "k", "--result-type", "dynamic"]);
    expect(body()).toEqual({ query: "hi", result_type: "dynamic" });
  });

  it("refuses an unknown --result-type before any request", async () => {
    await expect(
      makeProgram().parseAsync(["node", "octen", "premier", "hi", "--api-key", "k", "--result-type", "deep"]),
    ).rejects.toThrow(/--result-type must be one of: standard, dynamic/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("forwards the options it shares with search", async () => {
    await makeProgram().parseAsync([
      "node", "octen", "premier", "hi", "--json", "--api-key", "k",
      "-n", "7", "--include-domains", "a.com,b.com", "--exclude-text", "x", "--language", "en,ja",
      "--time-range", "week", "--format", "markdown", "--safesearch", "off",
      "--highlight", "--highlight-max-tokens", "300", "--full-content", "--images",
    ]);
    expect(body()).toEqual({
      query: "hi",
      count: 7,
      include_domains: ["a.com", "b.com"],
      exclude_text: ["x"],
      language: ["en", "ja"],
      time_range: "week",
      format: "markdown",
      safesearch: "off",
      highlight: { enable: true, max_tokens: 300 },
      full_content: { enable: true },
      include_images: true,
    });
  });

  // The reference gives the two endpoints one request body. `--topic` is
  // search's own and `--result-type` is offered here only, so those two are
  // the whole of the difference — a flag added to one and not the other shows
  // up here.
  it("takes search's flags, less --topic, plus --result-type", () => {
    const prog = makeProgram();
    const search = flags(prog, "search");
    expect(search).toContain("--topic");
    expect(search.length).toBeGreaterThan(10);
    expect(flags(prog, "premier")).toEqual(
      [...search.filter((f) => f !== "--topic"), "--result-type"].sort(),
    );
  });

  it("does not accept --topic", async () => {
    await expect(
      makeProgram().parseAsync(["node", "octen", "premier", "hi", "--api-key", "k", "--topic", "news"]),
    ).rejects.toThrow(/unknown option '--topic'/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a blank query before any request", async () => {
    await expect(
      makeProgram().parseAsync(["node", "octen", "premier", "  ", "--api-key", "k"]),
    ).rejects.toThrow("query is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("prints the raw envelope with --json", async () => {
    await makeProgram().parseAsync(["node", "octen", "premier", "hi", "--json", "--api-key", "k"]);
    expect(JSON.parse(written())).toMatchObject({ request_id: "req-1", data: { results: [{ title: "A result" }] } });
  });

  it("prints results the way search does with --pretty", async () => {
    await makeProgram().parseAsync(["node", "octen", "premier", "hi", "--pretty", "--api-key", "k"]);
    expect(written()).toContain("A result");
    expect(written()).toContain("https://a.test/x");
    expect(written()).toContain("its highlight");
  });
});
