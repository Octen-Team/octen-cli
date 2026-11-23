import { describe, it, expect } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

function runCli(args: string[]): string {
  return execFileSync("node", ["--import", "tsx", "src/cli.ts", ...args], { encoding: "utf8" });
}

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * Run the CLI and capture its exit status. Async on purpose: a synchronous
 * child blocks this process's event loop, so an in-process fixture server
 * could never accept the connection.
 */
function runCliAsync(args: string[]): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn("node", ["--import", "tsx", "src/cli.ts", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += String(c)));
    child.stderr.on("data", (c) => (stderr += String(c)));
    child.on("close", (status) => resolve({ status: status ?? -1, stdout, stderr }));
  });
}

/** Run the CLI synchronously and capture the exit status (no fixture server). */
function runCliExpectingFailure(args: string[]): CliResult {
  try {
    const stdout = runCli(args);
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      status: e.status ?? -1,
      stdout: String(e.stdout ?? ""),
      stderr: String(e.stderr ?? ""),
    };
  }
}

/**
 * A loopback SSE server. No external network: the CLI talks to 127.0.0.1 only,
 * which is the one way to prove the real process exit status end to end.
 */
async function withSseServer(
  body: string,
  run: (baseUrl: string) => Promise<CliResult>,
): Promise<CliResult> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("cli", () => {
  it("prints version", () => {
    expect(runCli(["--version"]).trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it("lists commands in help", () => {
    const help = runCli(["--help"]);
    for (const c of ["search", "extract", "chat", "embed", "vl-embed", "configure-mcp", "configure-skills", "reset"]) {
      expect(help).toContain(c);
    }
  });
});

describe("cli exit codes", () => {
  it("exits 2 on a malformed numeric flag", () => {
    const result = runCliExpectingFailure([
      "search", "hi", "--count", "1.5", "--api-key", "test-key",
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--count must be an integer");
  });

  it("exits 2 on an empty comma list", () => {
    const result = runCliExpectingFailure([
      "search", "hi", "--include-domains", "", "--api-key", "test-key",
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("at least one non-empty value");
  });

  it("exits 1 after a typed stream error, keeping the partial answer", async () => {
    const body =
      'data: {"type":"content","choices":[{"delta":{"content":"partial"}}]}\n\n' +
      'data: {"type":"error","error":{"message":"quota exceeded","code":"rate_limit"}}\n\n' +
      "data: [DONE]\n\n";

    const result = await withSseServer(body, (baseUrl) =>
      runCliAsync([
        "chat", "hello", "-m", "test-model", "--pretty",
        "--api-key", "test-key", "--base-url", baseUrl,
      ]),
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("partial");
    expect(result.stderr).toContain("quota exceeded");
  });

  it("exits 1 when the stream ends without a terminator", async () => {
    const body = 'data: {"type":"content","choices":[{"delta":{"content":"half"}}]}\n\n';

    const result = await withSseServer(body, (baseUrl) =>
      runCliAsync([
        "chat", "hello", "-m", "test-model", "--pretty",
        "--api-key", "test-key", "--base-url", baseUrl,
      ]),
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("half");
    expect(result.stderr).toMatch(/stream ended before the response was complete/);
  });

  it("emits a CRLF-framed event before the stream ends", async () => {
    const body =
      'data: {"type":"content","choices":[{"delta":{"content":"crlf-ok"}}]}\r\n\r\n' +
      "data: [DONE]\r\n\r\n";

    const result = await withSseServer(body, (baseUrl) =>
      runCliAsync([
        "chat", "hello", "-m", "test-model", "--pretty",
        "--api-key", "test-key", "--base-url", baseUrl,
      ]),
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("crlf-ok");
  });
});

interface SeenRequest {
  method?: string;
  url?: string;
  apiKey?: string;
  body: unknown;
}

/**
 * A loopback JSON server that answers every request with one fixed reply and
 * records what it was sent, so a test can check both ends of a real process:
 * the request the CLI made and the status it exited with.
 */
async function withJsonServer(
  status: number,
  reply: unknown,
  run: (baseUrl: string) => Promise<CliResult>,
): Promise<{ result: CliResult; seen: SeenRequest[] }> {
  const seen: SeenRequest[] = [];
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += String(c)));
    req.on("end", () => {
      seen.push({
        method: req.method,
        url: req.url,
        apiKey: String(req.headers["x-api-key"] ?? ""),
        body: raw ? JSON.parse(raw) : undefined,
      });
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return { result: await run(`http://127.0.0.1:${port}`), seen };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("premier-search and design-search, as a real process", () => {
  const envelope = (data: unknown) => ({ code: 0, msg: "success", request_id: "req-1", data });

  it("lists both commands in help", () => {
    const help = runCli(["--help"]);
    expect(help).toMatch(/^\s+premier-search /m);
    expect(help).toMatch(/^\s+design-search /m);
  });

  // Completion is built by introspecting the program, so both commands should
  // appear in it with their own flags and no entry written by hand.
  it("completes both commands in the real program", () => {
    const script = runCli(["completion", "bash"]);
    expect(script).toMatch(/^    premier-search\)\n      opts="[^"]*--result-type/m);
    expect(script).toMatch(/^    design-search\)\n      opts="[^"]*--group/m);
  });

  it("premier-search posts to /search-premier with the key, and prints the envelope", async () => {
    const reply = envelope({ results: [{ title: "A result", url: "https://a.test/x" }] });
    const { result, seen } = await withJsonServer(200, reply, (baseUrl) =>
      runCliAsync(["premier-search", "rust", "async", "--result-type", "dynamic", "--api-key", "test-key", "--base-url", baseUrl]),
    );
    expect(result.status).toBe(0);
    expect(seen).toEqual([{
      method: "POST",
      url: "/search-premier",
      apiKey: "test-key",
      body: { query: "rust async", result_type: "dynamic" },
    }]);
    // stdout is a pipe here, so the output is the raw JSON.
    expect(JSON.parse(result.stdout)).toEqual(reply);
  });

  it("design-search fetches a group without a query", async () => {
    const reply = envelope({ images: [{ type: "slide", title: "One" }], results: [] });
    const { result, seen } = await withJsonServer(200, reply, (baseUrl) =>
      runCliAsync(["design-search", "--group", "deck_abc", "-n", "28", "--no-web", "--api-key", "test-key", "--base-url", baseUrl]),
    );
    expect(result.status).toBe(0);
    expect(seen).toEqual([{
      method: "POST",
      url: "/design-search",
      apiKey: "test-key",
      body: { images: { count: 28, group_id: "deck_abc" }, web_search: { enable: false } },
    }]);
    expect(JSON.parse(result.stdout)).toEqual(reply);
  });

  it("design-search prints the references when asked for --pretty", async () => {
    const reply = envelope({
      images: [{ type: "web_page", title: "A page design", url: "https://img.test/a.png", width: 1440, height: 900 }],
    });
    const { result } = await withJsonServer(200, reply, (baseUrl) =>
      runCliAsync(["design-search", "pricing", "page", "--pretty", "--no-color", "--api-key", "test-key", "--base-url", baseUrl]),
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1. A page design");
    expect(result.stdout).toContain("web_page · 1440x900");
  });

  // The API's own code and message, as it sent them, and a non-zero exit.
  it("exits 1 with the API's message when the request is rejected", async () => {
    const { result, seen } = await withJsonServer(400, { code: 40001, msg: "Invalid params.", request_id: "r" }, (baseUrl) =>
      runCliAsync(["design-search", "hero", "--api-key", "test-key", "--base-url", baseUrl]),
    );
    expect(seen).toHaveLength(1);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid params.");
    expect(result.stdout).toBe("");
  });

  // An error message is response text too, and it reaches the terminal by a
  // different road: the client throws, and the entry point prints it.
  it("shows control characters in an API error message instead of sending them", async () => {
    const ESC = "\u001b";
    for (const command of ["design-search", "premier-search"]) {
      const { result } = await withJsonServer(400, { code: 40001, msg: `Invalid${ESC}[2J params.\rhidden`, request_id: "r" }, (baseUrl) =>
        runCliAsync([command, "hero", "--no-color", "--api-key", "test-key", "--base-url", baseUrl]),
      );
      expect(result.status).toBe(1);
      expect(result.stderr).not.toContain(`${ESC}[2J`);
      expect(result.stderr).not.toContain("\r");
      expect(result.stderr).toContain("Invalid\\x1b[2J params.");
    }
  });

  const refused: Array<[string, string[], string]> = [
    ["design-search with neither a query nor a group", ["design-search"], "give a query, or --group"],
    ["design-search with both result groups off", ["design-search", "hero", "--no-images", "--no-web"], "leave nothing to return"],
    ["design-search with a group and --no-images", ["design-search", "--group", "deck_abc", "--no-images"], "cannot be combined with --no-images"],
    ["design-search with a web option and --no-web", ["design-search", "hero", "--no-web", "--language", "en"], "--language applies to the web results"],
    ["premier-search with an unknown result type", ["premier-search", "hi", "--result-type", "deep"], "--result-type must be one of"],
  ];
  for (const [what, argv, message] of refused) {
    it(`exits 2 before any request: ${what}`, async () => {
      const { result, seen } = await withJsonServer(200, envelope({}), (baseUrl) =>
        runCliAsync([...argv, "--api-key", "test-key", "--base-url", baseUrl]),
      );
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(message);
      expect(seen).toEqual([]);
    });
  }
});
