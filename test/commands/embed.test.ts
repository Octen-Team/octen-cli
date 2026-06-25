import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { registerEmbed } from "../../src/commands/embed.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const MOCK_RESPONSE = {
  model: "octen-embedding-4b",
  data: [{ embedding: [1, 2, 3] }],
};

function makeProgram() {
  const prog = new Command();
  prog
    .name("octen")
    .option("--api-key <key>", "Octen API key")
    .option("--base-url <url>", "API base URL")
    .option("--json", "raw JSON output")
    .option("--pretty", "human-readable output")
    .exitOverride();
  registerEmbed(prog);
  return prog;
}

describe("embed command", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(MOCK_RESPONSE),
    );
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs to /embedding with input body and outputs JSON when --json is set", async () => {
    const prog = makeProgram();
    await prog.parseAsync(["node", "octen", "embed", "hello", "--json", "--api-key", "k"]);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/embedding");
    expect((init as RequestInit).method).toBe("POST");

    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ input: "hello" });

    expect(writeSpy).toHaveBeenCalled();
    const captured = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(captured);
    expect(parsed).toMatchObject(MOCK_RESPONSE);
  });

  it("applies model alias: -m 4b → octen-embedding-4b in body", async () => {
    const prog = makeProgram();
    await prog.parseAsync(["node", "octen", "embed", "hello", "-m", "4b", "--json", "--api-key", "k"]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ input: "hello", model: "octen-embedding-4b" });
  });

  it("multiple positional args → input is an array", async () => {
    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "embed", "hello", "world", "--json", "--api-key", "k",
    ]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.input).toEqual(["hello", "world"]);
  });

  it("passes --dimension to request body", async () => {
    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "embed", "hello",
      "--dimension", "512", "--json", "--api-key", "k",
    ]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.dimension).toBe(512);
  });

  it("passes --input-type to request body as input_type", async () => {
    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "embed", "hello",
      "--input-type", "query", "--json", "--api-key", "k",
    ]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.input_type).toBe("query");
  });

  it("passes --no-truncation to request body as truncation: false", async () => {
    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "embed", "hello",
      "--no-truncation", "--json", "--api-key", "k",
    ]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.truncation).toBe(false);
  });

  it("passes full model id through without aliasing", async () => {
    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "embed", "hello",
      "--model", "octen-embedding-4b", "--json", "--api-key", "k",
    ]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("octen-embedding-4b");
  });

  it("rejects non-integer --dimension", async () => {
    const prog = makeProgram();
    await expect(
      prog.parseAsync(["node", "octen", "embed", "hello", "--dimension", "abc", "--api-key", "k"]),
    ).rejects.toThrow(/integer/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws OctenValidationError when no input is provided and stdin is a TTY", async () => {
    // Force stdin to look like a TTY so the command doesn't block waiting for piped input
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    try {
      const prog = makeProgram();
      await expect(
        prog.parseAsync(["node", "octen", "embed", "--json", "--api-key", "k"]),
      ).rejects.toThrow(/no input/);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
    }
  });
});
