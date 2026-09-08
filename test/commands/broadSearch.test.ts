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
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ data: { results: [] }, code: 0, msg: "success" }),
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
