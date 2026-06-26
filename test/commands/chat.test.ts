import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Readable } from "node:stream";
import { Command } from "commander";
import { registerChat } from "../../src/commands/chat.js";

// ── Fake node:readline for the REPL (-i) tests ─────────────────────────────
// We capture the `line`/`close` listeners the command registers, then drive a
// scripted sequence by invoking the line listener directly (it returns a
// promise we can await) and finally invoking the close listener so the REPL's
// `await new Promise(resolve => rl.on("close", resolve))` resolves.
interface FakeRl {
  listeners: Record<string, ((arg: any) => void) | undefined>;
  prompt: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: (event: string, cb: (arg: any) => void) => FakeRl;
  emitLine: (line: string) => Promise<void>;
  emitClose: () => void;
}

function makeFakeRl(): FakeRl {
  const rl: FakeRl = {
    listeners: {},
    prompt: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    // close() should trigger the registered "close" listener (the REPL relies
    // on it to resolve), mirroring real readline behavior.
    close: vi.fn(() => {
      rl.listeners["close"]?.(undefined);
    }),
    on(event, cb) {
      rl.listeners[event] = cb;
      return rl;
    },
    async emitLine(line) {
      // The command's line listener is async; await its returned promise so
      // the mocked fetch resolves and history mutates before we continue.
      await rl.listeners["line"]?.(line);
    },
    emitClose() {
      rl.listeners["close"]?.(undefined);
    },
  };
  return rl;
}

const fakeRlHolder: { current: FakeRl | null } = { current: null };

vi.mock("node:readline", () => ({
  createInterface: () => {
    const rl = makeFakeRl();
    fakeRlHolder.current = rl;
    return rl;
  },
}));

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

describe("chat REPL (-i) interactive mode", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fakeRlHolder.current = null;
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accumulates history across turns, supports /reset and /exit", async () => {
    // Each request gets a distinct reply so we can verify history accumulation.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: "reply" } }] }),
    );

    const prog = makeProgram();
    // parseAsync resolves only when the REPL's "close" listener fires; the
    // command registers listeners synchronously before awaiting, so the fake
    // interface is available immediately after we kick off parseAsync.
    const done = prog.parseAsync([
      "node", "octen", "chat", "-i",
      "-m", "test-model",
      "--system", "You are helpful",
      "--api-key", "k",
    ]);

    const rl = fakeRlHolder.current!;
    expect(rl).toBeTruthy();

    // Turn 1
    await rl.emitLine("first question");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    let body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    // System prompt + first user turn.
    expect(body.messages).toEqual([
      { role: "system", content: "You are helpful" },
      { role: "user", content: "first question" },
    ]);
    // Assistant reply printed to stdout.
    const afterTurn1 = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(afterTurn1).toContain("reply");

    // Turn 2 — history must include the prior assistant turn.
    await rl.emitLine("second question");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    body = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string);
    expect(body.messages).toEqual([
      { role: "system", content: "You are helpful" },
      { role: "user", content: "first question" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "second question" },
    ]);

    // /reset clears history; the system prompt is re-added.
    await rl.emitLine("/reset");
    await rl.emitLine("third question");
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    body = JSON.parse((fetchSpy.mock.calls[2][1] as RequestInit).body as string);
    expect(body.messages).toEqual([
      { role: "system", content: "You are helpful" },
      { role: "user", content: "third question" },
    ]);

    // /exit ends the REPL: it calls rl.close(), which fires the close listener
    // and resolves parseAsync.
    await rl.emitLine("/exit");
    expect(rl.close).toHaveBeenCalled();

    await done;
    // No further requests after /exit.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});

describe("chat piped stdin prompt", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;
  const origStdin = process.stdin;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Restore the real stdin descriptor.
    Object.defineProperty(process, "stdin", {
      value: origStdin,
      configurable: true,
    });
  });

  /** Swap process.stdin for a non-TTY Readable emitting the given content. */
  function pipeStdin(content: string | null): void {
    const readable = Readable.from(content == null ? [] : [content]) as any;
    readable.isTTY = false;
    Object.defineProperty(process, "stdin", {
      value: readable,
      configurable: true,
    });
  }

  it("reads the prompt from piped stdin when no positional arg is given", async () => {
    pipeStdin("hello world\n");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: "ok" } }] }),
    );

    const prog = makeProgram();
    await prog.parseAsync([
      "node", "octen", "chat",
      "-m", "m",
      "--no-stream",
      "--json",
      "--api-key", "k",
    ]);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    // Trailing newline is trimmed by the command.
    expect(body.messages).toEqual([{ role: "user", content: "hello world" }]);
  });

  it("rejects with /no prompt/ when stdin is empty", async () => {
    pipeStdin(null);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: "ok" } }] }),
    );

    const prog = makeProgram();
    await expect(
      prog.parseAsync([
        "node", "octen", "chat",
        "-m", "m",
        "--no-stream",
        "--json",
        "--api-key", "k",
      ]),
    ).rejects.toThrow(/no prompt/);
  });
});
