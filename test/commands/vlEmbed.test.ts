import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { registerVlEmbed } from "../../src/commands/vlEmbed.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const MOCK_RESPONSE = {
  model: "octen-vl-embedding",
  data: [{ embedding: [1, 2, 3], type: "fusion" }],
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
  registerVlEmbed(prog);
  return prog;
}

describe("vl-embed command", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(MOCK_RESPONSE));
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs to /vl-embedding with correct body and outputs JSON when --json is set", async () => {
    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "vl-embed",
      "text:a cat",
      "image:https://x.com/c.png",
      "-m", "base",
      "--fusion",
      "--json",
      "--api-key", "k",
    ]);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/vl-embedding");
    expect((init as RequestInit).method).toBe("POST");

    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      model: "octen-vl-embedding",
      input: {
        contents: [
          { text: "a cat" },
          { image: "https://x.com/c.png" },
        ],
      },
      enable_fusion: true,
    });

    expect(writeSpy).toHaveBeenCalled();
    const captured = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(captured);
    expect(parsed).toMatchObject(MOCK_RESPONSE);
  });

  it("maps model alias 'large' to 'octen-vl-embedding-large' in body", async () => {
    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "vl-embed",
      "text:hello",
      "-m", "large",
      "--json",
      "--api-key", "k",
    ]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("octen-vl-embedding-large");
  });

  it("passes full model id through without aliasing", async () => {
    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "vl-embed",
      "text:hello",
      "--model", "octen-vl-embedding",
      "--json",
      "--api-key", "k",
    ]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("octen-vl-embedding");
  });

  it("omits enable_fusion when neither --fusion nor --no-fusion is passed", async () => {
    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "vl-embed",
      "text:hello",
      "-m", "base",
      "--json",
      "--api-key", "k",
    ]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(Object.keys(body)).not.toContain("enable_fusion");
  });

  it("sends enable_fusion: false when --no-fusion is passed", async () => {
    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "vl-embed",
      "text:hello",
      "-m", "base",
      "--no-fusion",
      "--json",
      "--api-key", "k",
    ]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.enable_fusion).toBe(false);
  });

  it("passes --dimension to request body", async () => {
    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "vl-embed",
      "text:hello",
      "-m", "base",
      "--dimension", "512",
      "--json",
      "--api-key", "k",
    ]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.dimension).toBe(512);
  });

  it("passes --fps to request body", async () => {
    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "vl-embed",
      "text:hello",
      "-m", "base",
      "--fps", "2.5",
      "--json",
      "--api-key", "k",
    ]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.fps).toBe(2.5);
  });

  it("passes --instruct to request body", async () => {
    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "vl-embed",
      "text:hello",
      "-m", "base",
      "--instruct", "describe the scene",
      "--json",
      "--api-key", "k",
    ]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.instruct).toBe("describe the scene");
  });

  it("rejects non-integer --dimension", async () => {
    const prog = makeProgram();
    await expect(
      prog.parseAsync([
        "node", "octen", "vl-embed",
        "text:hello",
        "-m", "base",
        "--dimension", "abc",
        "--api-key", "k",
      ]),
    ).rejects.toThrow(/integer/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects bad token prefix with /invalid content token/", async () => {
    const prog = makeProgram();
    await expect(
      prog.parseAsync([
        "node", "octen", "vl-embed",
        "foo:bar",
        "-m", "base",
        "--api-key", "k",
      ]),
    ).rejects.toThrow(/invalid content token/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects missing model with /model is required/", async () => {
    const prog = makeProgram();
    await expect(
      prog.parseAsync([
        "node", "octen", "vl-embed",
        "text:hello",
        "--api-key", "k",
      ]),
    ).rejects.toThrow(/model is required/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("preserves order of multiple content tokens", async () => {
    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "vl-embed",
      "text:first",
      "image:https://a.com/1.png",
      "text:last",
      "-m", "base",
      "--json",
      "--api-key", "k",
    ]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.input.contents).toEqual([
      { text: "first" },
      { image: "https://a.com/1.png" },
      { text: "last" },
    ]);
  });
});
