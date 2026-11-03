import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import {
  registerBusinessSearch,
  registerNewsSearch,
  registerPulseSearch,
} from "../../src/commands/verticalSearch.js";
import { registerPlaceSearch } from "../../src/commands/placeSearch.js";

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
    .exitOverride();
  registerNewsSearch(prog);
  registerBusinessSearch(prog);
  registerPlaceSearch(prog);
  registerPulseSearch(prog);
  return prog;
}

describe("vertical search commands", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // A Response body reads once, so each call needs its own — a single
    // mockResolvedValue hands the same consumed object to the second call.
    fetchSpy = vi.spyOn(globalThis, "fetch" as any).mockImplementation(
      () => Promise.resolve(jsonResponse({ code: 0, msg: "success", data: { results: [] } })) as any,
    );
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const url = () => String(fetchSpy.mock.calls[0]?.[0]);
  const body = () => JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as any)?.body));

  it("each command posts to its own endpoint", async () => {
    const cases: Array<[string[], string]> = [
      [["news", "x"], "/news-search"],
      [["business", "x"], "/business-search"],
      [["place", "x"], "/place-search"],
      [["pulse", "x"], "/pulse-search"],
    ];
    for (const [argv, endpoint] of cases) {
      fetchSpy.mockClear();
      await makeProgram().parseAsync(["node", "octen", ...argv, "--json", "--api-key", "k"]);
      expect(url()).toContain(endpoint);
    }
  });

  // commander turns `--no-subjects` into `subjects: false` and defaults it to
  // `true` when the flag is declared — not `undefined`. Reading it as `noSubjects`
  // would silently never fire, and the block would never be disabled.
  it("--no-subjects disables the clustering; omitting it sends no block", async () => {
    await makeProgram().parseAsync(["node", "octen", "news", "x", "--json", "--api-key", "k"]);
    expect(body()).not.toHaveProperty("subjects");

    fetchSpy.mockClear();
    await makeProgram().parseAsync(["node", "octen", "news", "x", "--no-subjects", "--json", "--api-key", "k"]);
    expect(body().subjects).toEqual({ enable: false });
  });

  it("--no-entities disables the cards; omitting it sends no block", async () => {
    await makeProgram().parseAsync(["node", "octen", "business", "x", "--json", "--api-key", "k"]);
    expect(body()).not.toHaveProperty("entities");

    fetchSpy.mockClear();
    await makeProgram().parseAsync(["node", "octen", "business", "x", "--no-entities", "--json", "--api-key", "k"]);
    expect(body().entities).toEqual({ enable: false });
  });

  it("news does not send the options /news-search ignores", async () => {
    await makeProgram().parseAsync([
      "node", "octen", "news", "x", "--json", "--api-key", "k",
      "--include-domains", "reuters.com", "--language", "en",
    ]);
    const b = body();
    expect(b).toMatchObject({ include_domains: ["reuters.com"], language: ["en"] });
    for (const key of ["include_text", "format", "safesearch", "include_images", "topic"]) {
      expect(b).not.toHaveProperty(key);
    }
  });

  it("place nests count and max_reviews, and keeps coordinates top-level", async () => {
    await makeProgram().parseAsync([
      "node", "octen", "place", "coffee", "--json", "--api-key", "k",
      "--latitude", "35.6812", "--longitude", "139.7671", "-n", "2", "--max-reviews", "3",
    ]);
    expect(body()).toEqual({
      query: "coffee",
      latitude: 35.6812,
      longitude: 139.7671,
      places: { count: 2, max_reviews: 3 },
    });
  });

  it("place parses coordinates as floats, not integers", async () => {
    await makeProgram().parseAsync([
      "node", "octen", "place", "x", "--json", "--api-key", "k",
      "--latitude", "35.6812", "--longitude", "-139.7671",
    ]);
    expect(body().latitude).toBe(35.6812);
    expect(body().longitude).toBe(-139.7671);
  });

  it("pulse sends mode and count, and no retrieval filters", async () => {
    await makeProgram().parseAsync([
      "node", "octen", "pulse", "uv docs", "--json", "--api-key", "k", "--mode", "standard", "-n", "3",
    ]);
    expect(body()).toEqual({ query: "uv docs", mode: "standard", count: 3 });
  });
});
