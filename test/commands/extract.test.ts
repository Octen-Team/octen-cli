import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { registerExtract } from "../../src/commands/extract.js";
import { OctenValidationError } from "../../src/api/errors.js";

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
  registerExtract(prog);
  return prog;
}

describe("extract command", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        data: { results: [{ url: "https://x.com", status: "success", title: "T" }] },
        code: 0,
        msg: "success",
      }),
    );
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls /extract with urls body and outputs JSON when --json is set", async () => {
    const prog = makeProgram();
    await prog.parseAsync(["node", "octen", "extract", "https://x.com", "--json", "--api-key", "k"]);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain("/extract");

    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ urls: ["https://x.com"] });

    expect(writeSpy).toHaveBeenCalled();
    const captured = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(captured);
    expect(parsed).toMatchObject({ data: { results: [{ url: "https://x.com", status: "success", title: "T" }] } });
  });

  it("auto-prefixes bare host to https:// in request body", async () => {
    const prog = makeProgram();
    await prog.parseAsync(["node", "octen", "extract", "example.com", "--json", "--api-key", "k"]);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ urls: ["https://example.com"] });
  });

  it("passes --query to request body", async () => {
    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "extract", "https://x.com",
      "--json", "--api-key", "k", "--query", "AI trends",
    ]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ query: "AI trends" });
  });

  it("passes --format to request body", async () => {
    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "extract", "https://x.com",
      "--json", "--api-key", "k", "--format", "text",
    ]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ format: "text" });
  });

  it("passes --fetch-timeout to request body as timeout", async () => {
    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "extract", "https://x.com",
      "--json", "--api-key", "k", "--fetch-timeout", "30",
    ]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ timeout: 30 });
  });

  it("passes --images flag to request body", async () => {
    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "extract", "https://x.com",
      "--json", "--api-key", "k", "--images",
    ]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ include_images: true });
  });

  it("rejects non-integer --fetch-timeout", async () => {
    const prog = makeProgram();
    await expect(
      prog.parseAsync(["node", "octen", "extract", "https://x.com", "--fetch-timeout", "abc", "--api-key", "k"]),
    ).rejects.toThrow(/integer/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts multiple URLs", async () => {
    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "extract", "https://a.com", "https://b.com",
      "--json", "--api-key", "k",
    ]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.urls).toEqual(["https://a.com", "https://b.com"]);
  });

  it("does not send mode unless --mode is given", async () => {
    const prog = makeProgram();
    await prog.parseAsync(["node", "octen", "extract", "https://x.com", "--json", "--api-key", "k"]);
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body).not.toHaveProperty("mode");
    expect(body).not.toHaveProperty("include_links");
  });

  it("passes --mode to request body", async () => {
    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "extract", "https://x.com",
      "--json", "--api-key", "k", "--mode", "advanced",
    ]);
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ mode: "advanced" });
  });

  it("rejects an invalid --mode before any request", async () => {
    const prog = makeProgram();
    await expect(
      prog.parseAsync(["node", "octen", "extract", "https://x.com", "--mode", "fast", "--api-key", "k"]),
    ).rejects.toThrow(/--mode must be one of/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends include_links {} for a bare --links", async () => {
    const prog = makeProgram();
    await prog.parseAsync(["node", "octen", "extract", "https://x.com", "--links", "--json", "--api-key", "k"]);
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.include_links).toEqual({});
    expect(body.urls).toEqual(["https://x.com"]);
  });

  it("sends --links <scope> and --max-links together", async () => {
    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "extract", "https://x.com",
      "--links", "prefer_external", "--max-links", "20", "--json", "--api-key", "k",
    ]);
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.include_links).toEqual({ scope: "prefer_external", max_links: 20 });
  });

  it("lets --max-links alone imply include_links", async () => {
    const prog = makeProgram();
    await prog.parseAsync(["node", "octen", "extract", "https://x.com", "--max-links", "5", "--json", "--api-key", "k"]);
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.include_links).toEqual({ max_links: 5 });
  });

  it("rejects out-of-range --max-links before any request", async () => {
    const prog = makeProgram();
    await expect(
      prog.parseAsync(["node", "octen", "extract", "https://x.com", "--max-links", "1001", "--api-key", "k"]),
    ).rejects.toThrow(/max-links must be 1-1000/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("arms a client timeout derived from --fetch-timeout, not the 30s default", async () => {
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "extract", "https://x.com",
      "--fetch-timeout", "60", "--json", "--api-key", "k",
    ]);
    const delays = timeoutSpy.mock.calls.map((c) => c[1]);
    expect(delays).toContain(150_000);
    expect(delays).not.toContain(30_000);
  });

  it("arms a 120s client timeout when --fetch-timeout is omitted", async () => {
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const prog = makeProgram();
    await prog.parseAsync(["node", "octen", "extract", "https://x.com", "--json", "--api-key", "k"]);
    expect(timeoutSpy.mock.calls.map((c) => c[1])).toContain(120_000);
  });

  it("accepts --links=<scope>", async () => {
    const prog = makeProgram();
    await prog.parseAsync(["node", "octen", "extract", "u1.com", "--links=prefer_external", "--json", "--api-key", "k"]);
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.include_links).toEqual({ scope: "prefer_external" });
    expect(body.urls).toEqual(["https://u1.com"]);
  });

  it("accepts --links <scope> after the URLs", async () => {
    const prog = makeProgram();
    await prog.parseAsync(["node", "octen", "extract", "u1.com", "--links", "prefer_external", "--json", "--api-key", "k"]);
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.include_links).toEqual({ scope: "prefer_external" });
    expect(body.urls).toEqual(["https://u1.com"]);
  });

  it("names the mistake when --links swallows the only URL", async () => {
    const prog = makeProgram();
    await expect(
      prog.parseAsync(["node", "octen", "extract", "--links", "https://a.com", "--api-key", "k"]),
    ).rejects.toThrow(
      'got "https://a.com" as its scope; put --links after the URLs or use --links=<scope>',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("names the mistake when --links swallows a second URL", async () => {
    const prog = makeProgram();
    await expect(
      prog.parseAsync(["node", "octen", "extract", "a.com", "--links", "b.com", "--api-key", "k"]),
    ).rejects.toThrow(OctenValidationError);
    await expect(
      makeProgram().parseAsync(["node", "octen", "extract", "a.com", "--links", "b.com", "--api-key", "k"]),
    ).rejects.toThrow(/got "b\.com" as its scope/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an unknown word as a --links scope", async () => {
    const prog = makeProgram();
    await expect(
      prog.parseAsync(["node", "octen", "extract", "a.com", "--links", "external", "--api-key", "k"]),
    ).rejects.toThrow(/--links must be one of: prefer_internal, prefer_external/);
  });
});
