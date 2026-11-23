import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { registerBroadSearch } from "../../src/commands/broadSearch.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeProgram() {
  const prog = new Command();
  prog
    .name("octen")
    .option("--api-key <key>", "Octen API key")
    .option("--base-url <url>", "API base URL")
    .option("--json", "raw JSON output")
    .option("--pretty", "human-readable output")
    .exitOverride();
  registerBroadSearch(prog);
  return prog;
}

describe("broad-search command", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // One Response per call: a body can be read only once.
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(jsonResponse({ data: { results: [] }, code: 0, msg: "success" })),
    );
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts the query to /broad-search", async () => {
    const prog = makeProgram();
    await prog.parseAsync(["node", "octen", "broad-search", "hi", "--json", "--api-key", "k"]);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/broad-search");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ query: "hi" });
  });

  it("rejects an empty --include-domains before any request", async () => {
    const prog = makeProgram();
    await expect(
      prog.parseAsync([
        "node", "octen", "broad-search", "hi", "--include-domains", "", "--api-key", "k",
      ]),
    ).rejects.toThrow("--include-domains must contain at least one non-empty value");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("trims --include-domains items and drops interior empties", async () => {
    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "broad-search", "hi", "--json", "--api-key", "k",
      "--include-domains", " a.com, ,b.com ",
    ]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.search_options.include_domains).toEqual(["a.com", "b.com"]);
  });

  // Command output carries no meta, so the request body is the only place to see the wiring.
  it("puts --result-type under search_options, not at the top level", async () => {
    await makeProgram().parseAsync(["node", "octen", "broad-search", "hi", "--json", "--api-key", "k", "--result-type", "dynamic"]);
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ query: "hi", search_options: { result_type: "dynamic" } });

    fetchSpy.mockClear();
    await makeProgram().parseAsync(["node", "octen", "broad-search", "hi", "--json", "--api-key", "k"]);
    expect(JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)).toEqual({ query: "hi" });
  });

  it("rejects an invalid --result-type before any request", async () => {
    await expect(
      makeProgram().parseAsync(["node", "octen", "broad-search", "hi", "--api-key", "k", "--result-type", "fast"]),
    ).rejects.toThrow("--result-type must be one of: standard, dynamic");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only query before any request", async () => {
    const prog = makeProgram();
    await expect(
      prog.parseAsync(["node", "octen", "broad-search", "   ", "--api-key", "k"]),
    ).rejects.toThrow("query is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects --max-queries 0 before any request", async () => {
    const prog = makeProgram();
    await expect(
      prog.parseAsync([
        "node", "octen", "broad-search", "hi", "--max-queries", "0", "--api-key", "k",
      ]),
    ).rejects.toThrow("max-queries must be 1-30");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a malformed --max-queries before any request", async () => {
    const prog = makeProgram();
    await expect(
      prog.parseAsync([
        "node", "octen", "broad-search", "hi", "--max-queries", "3.7", "--api-key", "k",
      ]),
    ).rejects.toThrow("--max-queries must be an integer");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
