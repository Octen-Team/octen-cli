import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { registerChat } from "../../src/commands/chat.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeSSEResponse(events: unknown[]): Response {
  const encoder = new TextEncoder();
  const chunks = [
    ...events.map((ev) => `data: ${JSON.stringify(ev)}\n\n`),
    "data: [DONE]\n\n",
  ].join("");
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(chunks));
      controller.close();
    },
  });
  return new Response(stream);
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
  registerChat(prog);
  return prog;
}

describe("chat command", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("non-stream JSON path: POSTs to /v1/chat/completions, body has model+messages, stdout is JSON", async () => {
    const mockResp = { choices: [{ message: { content: "hi" } }] };
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(mockResp));

    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "chat", "hello",
      "-m", "test-model",
      "--no-stream",
      "--json",
      "--api-key", "k",
    ]);

    // Verify fetch was called with correct endpoint
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/v1/chat/completions");

    // Verify request body
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ model: "test-model" });
    expect(body.messages).toEqual([{ role: "user", content: "hello" }]);

    // Verify stdout is JSON
    const captured = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(captured);
    expect(parsed).toMatchObject({ choices: [{ message: { content: "hi" } }] });
  });

  it("streaming path: concatenates delta content from SSE events", async () => {
    const events = [
      { choices: [{ delta: { content: "He" } }] },
      { choices: [{ delta: { content: "llo" } }] },
    ];
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(makeSSEResponse(events));

    // Force pretty mode (streaming requires TTY-like pretty mode)
    const origIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "chat", "hi",
      "-m", "test-model",
      "--api-key", "k",
      "--pretty",
    ]);

    Object.defineProperty(process.stdout, "isTTY", { value: origIsTTY, configurable: true });

    // Collect all writes to stdout
    const captured = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(captured).toContain("He");
    expect(captured).toContain("llo");
    // The two deltas should be adjacent (no separator between them)
    expect(captured).toContain("Hello");
  });

  it("missing model rejects with /model is required/", async () => {
    const prog = makeProgram();
    // Don't set OCTEN_CHAT_MODEL env var and don't pass --model
    const origEnv = process.env.OCTEN_CHAT_MODEL;
    delete process.env.OCTEN_CHAT_MODEL;

    await expect(
      prog.parseAsync(["node", "octen", "chat", "hello", "--no-stream", "--json", "--api-key", "k"]),
    ).rejects.toThrow(/model is required/);

    if (origEnv !== undefined) process.env.OCTEN_CHAT_MODEL = origEnv;
  });

  it("system message is included as first message when --system is set", async () => {
    const mockResp = { choices: [{ message: { content: "reply" } }] };
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(mockResp));

    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "chat", "hello",
      "-m", "test-model",
      "--system", "You are helpful",
      "--no-stream",
      "--json",
      "--api-key", "k",
    ]);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.messages).toEqual([
      { role: "system", content: "You are helpful" },
      { role: "user", content: "hello" },
    ]);
  });

  it("--no-stream pretty path prints message content without JSON wrapper", async () => {
    const mockResp = { choices: [{ message: { content: "plain answer" } }] };
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(mockResp));

    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "chat", "question",
      "-m", "test-model",
      "--no-stream",
      "--pretty",
      "--api-key", "k",
    ]);

    const captured = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(captured).toContain("plain answer");
    // Should NOT be wrapped in JSON
    expect(() => JSON.parse(captured)).toThrow();
  });
});
