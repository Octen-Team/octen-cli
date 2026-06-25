import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { registerSearch } from "../../src/commands/search.js";

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
    .exitOverride(); // prevent process.exit in tests
  registerSearch(prog);
  registerSearch(prog, "news");
  return prog;
}

describe("search command", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ results: [{ title: "T", url: "https://x.com" }] }),
    );
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls /search with query body and outputs JSON when --json is set", async () => {
    const prog = makeProgram();
    await prog.parseAsync(["node", "octen", "search", "hi", "--json", "--api-key", "k"]);

    // Verify fetch was called with the /search URL
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain("/search");

    // Verify request body contains { query: "hi" }
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ query: "hi" });

    // Verify output is parseable JSON
    expect(writeSpy).toHaveBeenCalled();
    const captured = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(captured);
    expect(parsed).toMatchObject({ results: [{ title: "T", url: "https://x.com" }] });
  });

  it("news command forces topic=news in request body", async () => {
    const prog = makeProgram();
    await prog.parseAsync(["node", "octen", "news", "breaking", "--json", "--api-key", "k"]);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ query: "breaking", topic: "news" });
  });

  it("passes --count to request body", async () => {
    const prog = makeProgram();
    await prog.parseAsync(["node", "octen", "search", "hi", "--json", "--api-key", "k", "--count", "10"]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ query: "hi", count: 10 });
  });
});
