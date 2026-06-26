import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { registerFetch } from "../../src/commands/fetch.js";

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
  registerFetch(prog);
  return prog;
}

describe("fetch command", () => {
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
    await prog.parseAsync(["node", "octen", "fetch", "https://x.com", "--json", "--api-key", "k"]);

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
    await prog.parseAsync(["node", "octen", "fetch", "example.com", "--json", "--api-key", "k"]);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ urls: ["https://example.com"] });
  });

  it("passes --query to request body", async () => {
    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "fetch", "https://x.com",
      "--json", "--api-key", "k", "--query", "AI trends",
    ]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ query: "AI trends" });
  });

  it("passes --format to request body", async () => {
    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "fetch", "https://x.com",
      "--json", "--api-key", "k", "--format", "text",
    ]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ format: "text" });
  });

  it("passes --fetch-timeout to request body as timeout", async () => {
    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "fetch", "https://x.com",
      "--json", "--api-key", "k", "--fetch-timeout", "30",
    ]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ timeout: 30 });
  });

  it("passes --images flag to request body", async () => {
    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "fetch", "https://x.com",
      "--json", "--api-key", "k", "--images",
    ]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ include_images: true });
  });

  it("rejects non-integer --fetch-timeout", async () => {
    const prog = makeProgram();
    await expect(
      prog.parseAsync(["node", "octen", "fetch", "https://x.com", "--fetch-timeout", "abc", "--api-key", "k"]),
    ).rejects.toThrow(/integer/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts multiple URLs", async () => {
    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "fetch", "https://a.com", "https://b.com",
      "--json", "--api-key", "k",
    ]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.urls).toEqual(["https://a.com", "https://b.com"]);
  });
});
