import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, rmSync, writeSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("encodes a local image file as a base64 data URI", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
    const file = join(tmpdir(), `octen-vl-test-${Date.now()}.png`);
    writeFileSync(file, bytes);
    try {
      const prog = makeProgram();
      await prog.parseAsync([
        "node", "octen", "vl-embed",
        `image:${file}`,
        "-m", "base",
        "--json",
        "--api-key", "k",
      ]);

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [, init] = fetchSpy.mock.calls[0];
      const body = JSON.parse((init as RequestInit).body as string);
      const imageContent = body.input.contents[0];
      const expectedDataUri = `data:image/png;base64,${bytes.toString("base64")}`;
      expect(imageContent.image).toBe(expectedDataUri);
      // Also verify the decoded bytes match the original
      const encoded = imageContent.image.split(",")[1];
      expect(Buffer.from(encoded, "base64")).toEqual(bytes);
    } finally {
      rmSync(file, { force: true });
    }
  });

  it("rejects a missing local file with an error mentioning the file / 'not found'", async () => {
    const prog = makeProgram();
    await expect(
      prog.parseAsync([
        "node", "octen", "vl-embed",
        "image:/no/such/file.png",
        "-m", "base",
        "--api-key", "k",
      ]),
    ).rejects.toThrow(/not found/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a local file over 10MB with /max 10MB/", async () => {
    const file = join(tmpdir(), `octen-vl-big-${Date.now()}.png`);
    // Write a sparse ~11MB file: open, seek past 11MB, write a single byte.
    const fd = openSync(file, "w");
    const OVER_LIMIT = 11 * 1024 * 1024;
    writeSync(fd, Buffer.alloc(1), 0, 1, OVER_LIMIT);
    closeSync(fd);
    try {
      const prog = makeProgram();
      await expect(
        prog.parseAsync([
          "node", "octen", "vl-embed",
          `image:${file}`,
          "-m", "base",
          "--api-key", "k",
        ]),
      ).rejects.toThrow(/max 10MB/);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      rmSync(file, { force: true });
    }
  });
});
