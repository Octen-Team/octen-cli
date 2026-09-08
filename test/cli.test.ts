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
