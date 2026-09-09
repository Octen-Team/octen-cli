import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Command } from "commander";
import { registerLogin, browserCommand } from "../../src/commands/login.js";
import { readCredentials, writeCredentials, CREDENTIALS_VERSION } from "../../src/auth/store.js";

let tmpDirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "octen-login-cmd-"));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

function baseProgram(): Command {
  const prog = new Command();
  prog
    .name("octen")
    .option("--api-key <key>", "Octen API key")
    .option("--base-url <url>", "API base URL")
    .option("--json", "raw JSON output")
    .option("--pretty", "human-readable output")
    .exitOverride();
  return prog;
}

/** Fake token endpoint + fake key-exchange endpoint. No DCR call ever appears. */
function tokenAndKeyFetch() {
  return vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.endsWith("/api/oauth/token")) {
      return new Response(JSON.stringify({ access_token: "at-1" }), { status: 200 });
    }
    if (u.endsWith("/api/oauth/cli/key")) {
      return new Response(
        JSON.stringify({
          active: true,
          api_key: "resolved-key",
          expires_at: null,
          grant_id: "grant-1",
          account_id: "acct-1",
          account_type: "user",
        }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch to ${u}`);
  });
}

/**
 * Stands in for the real browser: pulls redirect_uri + state out of the
 * authorize URL it's "opened" with, and completes the loopback callback
 * exactly the way a browser redirect would.
 */
function autoCompleteBrowser(code = "auth-code-1") {
  return vi.fn((url: string) => {
    const u = new URL(url);
    const redirectUri = u.searchParams.get("redirect_uri")!;
    const state = u.searchParams.get("state")!;
    void fetch(`${redirectUri}?code=${code}&state=${state}`);
  });
}

async function freePort(): Promise<number> {
  const probe = createServer().listen(0, "127.0.0.1");
  await new Promise((r) => probe.once("listening", r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise((r) => probe.close(r));
  return port;
}

/** Polls captured stderr writes until one contains a URL, then parses it. */
async function waitForPrintedUrl(stderrSpy: ReturnType<typeof vi.spyOn>): Promise<URL> {
  let found: URL | undefined;
  await vi.waitFor(() => {
    const out = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    const match = out.match(/https?:\/\/\S+/);
    if (!match) throw new Error("no url printed yet");
    found = new URL(match[0]);
  });
  return found!;
}

describe("octen login", () => {
  it("--api-key stores the key with no network call", async () => {
    const h = tmp();
    const fetchImpl = vi.fn();
    const prog = baseProgram();
    registerLogin(prog, { home: h, fetchImpl: fetchImpl as any, openBrowser: vi.fn() });
    await prog.parseAsync(["node", "octen", "login", "--api-key", "manual-key"]);
    expect(readCredentials(h)).toMatchObject({ source: "api-key", apiKey: "manual-key" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("makes no DCR call: the fetch sequence is token -> cli/key only", async () => {
    const h = tmp();
    const fetchImpl = tokenAndKeyFetch();
    const openBrowser = autoCompleteBrowser();
    const prog = baseProgram();
    registerLogin(prog, { home: h, fetchImpl: fetchImpl as any, openBrowser });
    await prog.parseAsync(["node", "octen", "login"]);

    const urls = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual(["https://auth.octen.ai/api/oauth/token", "https://auth.octen.ai/api/oauth/cli/key"]);
    expect(urls.some((u) => u.includes("register"))).toBe(false);
  });

  it("full loopback flow stores source=login with the resolved key", async () => {
    const h = tmp();
    const fetchImpl = tokenAndKeyFetch();
    const openBrowser = autoCompleteBrowser();
    const prog = baseProgram();
    registerLogin(prog, { home: h, fetchImpl: fetchImpl as any, openBrowser });
    await prog.parseAsync(["node", "octen", "login"]);

    expect(openBrowser).toHaveBeenCalledTimes(1);
    const authorizeUrl = new URL(openBrowser.mock.calls[0][0] as string);
    expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizeUrl.searchParams.get("client_id")).toBe("octen-cli");

    const creds = readCredentials(h);
    expect(creds).toMatchObject({
      source: "login",
      issuer: "https://auth.octen.ai",
      resource: "https://cli.octen.ai",
      apiKey: "resolved-key",
      apiKeyExpiresAt: null,
      grantId: "grant-1",
      accountId: "acct-1",
      accountType: "user",
    });
    expect(creds).not.toHaveProperty("refreshToken");
  });

  it("revokes an existing login grant before starting a new one, best-effort", async () => {
    const h = tmp();
    writeCredentials(h, {
      version: CREDENTIALS_VERSION,
      source: "login",
      issuer: "https://auth.octen.ai",
      resource: "https://cli.octen.ai",
      apiKey: "old-key",
      apiKeyExpiresAt: null,
      grantId: "old-grant",
    });

    const revokedWithKeys: string[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/api/oauth/cli/revoke")) {
        revokedWithKeys.push(String((init?.headers as Record<string, string>)["x-api-key"]));
        return new Response("{}", { status: 200 });
      }
      if (u.endsWith("/api/oauth/token")) {
        return new Response(JSON.stringify({ access_token: "at-1" }), { status: 200 });
      }
      if (u.endsWith("/api/oauth/cli/key")) {
        return new Response(
          JSON.stringify({ active: true, api_key: "new-key", expires_at: null, grant_id: "new-grant" }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch to ${u}`);
    });
    const openBrowser = autoCompleteBrowser();
    const prog = baseProgram();
    registerLogin(prog, { home: h, fetchImpl: fetchImpl as any, openBrowser });
    await prog.parseAsync(["node", "octen", "login"]);

    expect(revokedWithKeys).toEqual(["old-key"]);
    expect(readCredentials(h)).toMatchObject({ grantId: "new-grant", apiKey: "new-key" });
  });

  it("a failed revoke (network error) does not block the new login", async () => {
    const h = tmp();
    writeCredentials(h, {
      version: CREDENTIALS_VERSION,
      source: "login",
      issuer: "https://auth.octen.ai",
      resource: "https://cli.octen.ai",
      apiKey: "old-key",
      apiKeyExpiresAt: null,
      grantId: "old-grant",
    });
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith("/api/oauth/cli/revoke")) throw new Error("ECONNRESET");
      if (u.endsWith("/api/oauth/token")) return new Response(JSON.stringify({ access_token: "at-1" }), { status: 200 });
      if (u.endsWith("/api/oauth/cli/key")) {
        return new Response(
          JSON.stringify({ active: true, api_key: "new-key", expires_at: null, grant_id: "new-grant" }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch to ${u}`);
    });
    const openBrowser = autoCompleteBrowser();
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerLogin(prog, { home: h, fetchImpl: fetchImpl as any, openBrowser });
    await prog.parseAsync(["node", "octen", "login"]);

    expect(readCredentials(h)).toMatchObject({ grantId: "new-grant" });
    const stderrOutput = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrOutput.toLowerCase()).toContain("revoke");
  });

  it("--no-browser prints the URL instead of opening it", async () => {
    const h = tmp();
    const fetchImpl = tokenAndKeyFetch();
    const openBrowser = vi.fn();
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerLogin(prog, { home: h, fetchImpl: fetchImpl as any, openBrowser });

    const pending = prog.parseAsync(["node", "octen", "login", "--no-browser"]);
    const printedUrl = await waitForPrintedUrl(stderrSpy);

    expect(openBrowser).not.toHaveBeenCalled();
    const redirectUri = printedUrl.searchParams.get("redirect_uri")!;
    const state = printedUrl.searchParams.get("state")!;
    await fetch(`${redirectUri}?code=abc&state=${state}`);
    await pending;

    expect(readCredentials(h)).toMatchObject({ source: "login" });
  });

  it("falls back to printing the URL when opening the browser fails", async () => {
    const h = tmp();
    const fetchImpl = tokenAndKeyFetch();
    const openBrowser = vi.fn(() => {
      throw new Error("spawn failed");
    });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerLogin(prog, { home: h, fetchImpl: fetchImpl as any, openBrowser });

    const pending = prog.parseAsync(["node", "octen", "login"]);
    const printedUrl = await waitForPrintedUrl(stderrSpy);

    expect(openBrowser).toHaveBeenCalledTimes(1);
    const redirectUri = printedUrl.searchParams.get("redirect_uri")!;
    const state = printedUrl.searchParams.get("state")!;
    await fetch(`${redirectUri}?code=abc&state=${state}`);
    await pending;

    expect(readCredentials(h)).toMatchObject({ source: "login" });
  });

  it("--port pins the loopback port", async () => {
    const h = tmp();
    const fetchImpl = tokenAndKeyFetch();
    const openBrowser = autoCompleteBrowser();
    const prog = baseProgram();
    registerLogin(prog, { home: h, fetchImpl: fetchImpl as any, openBrowser });

    const port = await freePort();
    await prog.parseAsync(["node", "octen", "login", "--port", String(port)]);

    const authorizeUrl = new URL(openBrowser.mock.calls[0][0] as string);
    const redirectUri = new URL(authorizeUrl.searchParams.get("redirect_uri")!);
    expect(redirectUri.port).toBe(String(port));
  });

  it("progress messages go to stderr, not stdout", async () => {
    const h = tmp();
    const fetchImpl = tokenAndKeyFetch();
    const openBrowser = autoCompleteBrowser();
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerLogin(prog, { home: h, fetchImpl: fetchImpl as any, openBrowser });
    await prog.parseAsync(["node", "octen", "login"]);

    const stdoutOutput = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stdoutOutput).not.toContain("http");
    expect(stderrSpy.mock.calls.length).toBeGreaterThan(0);
  });

  it("builds a Windows command that survives & in the URL", () => {
    const url = "https://auth.octen.ai/oauth/authorize?a=1&b=2&state=x";
    expect(browserCommand("win32", url)).toEqual(["rundll32", ["url.dll,FileProtocolHandler", url]]);
    expect(browserCommand("darwin", url)).toEqual(["open", [url]]);
    expect(browserCommand("linux", url)).toEqual(["xdg-open", [url]]);
  });

  it("a failed exchange leaves no partial credential file", async () => {
    const h = tmp();
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith("/api/oauth/token")) return new Response(JSON.stringify({ access_token: "at-1" }), { status: 200 });
      if (u.endsWith("/api/oauth/cli/key")) return new Response("{}", { status: 503 });
      throw new Error(`unexpected fetch to ${u}`);
    });
    const openBrowser = autoCompleteBrowser();
    const prog = baseProgram();
    registerLogin(prog, { home: h, fetchImpl: fetchImpl as any, openBrowser });

    await expect(prog.parseAsync(["node", "octen", "login"])).rejects.toThrow();
    expect(readCredentials(h)).toBeUndefined();
  });
});
