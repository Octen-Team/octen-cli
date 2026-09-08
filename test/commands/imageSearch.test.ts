import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { registerImageSearch } from "../../src/commands/imageSearch.js";

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
  registerImageSearch(prog);
  return prog;
}

describe("image-search command", () => {
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

  it("posts the query to /image-search as a single text input", async () => {
    const prog = makeProgram();
    await prog.parseAsync(["node", "octen", "image-search", "cats", "--json", "--api-key", "k"]);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/image-search");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.inputs).toEqual([{ type: "text", data: "cats" }]);
  });

  it("rejects an empty --exclude-domains before any request", async () => {
    const prog = makeProgram();
    await expect(
      prog.parseAsync([
        "node", "octen", "image-search", "cats", "--exclude-domains", "", "--api-key", "k",
      ]),
    ).rejects.toThrow("--exclude-domains must contain at least one non-empty value");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("trims --include-domains items and drops interior empties", async () => {
    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "image-search", "cats", "--json", "--api-key", "k",
      "--include-domains", " a.com, ,b.com ",
    ]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.include_domains).toEqual(["a.com", "b.com"]);
  });
});
