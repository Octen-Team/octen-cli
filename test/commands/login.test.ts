import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Command } from "commander";
import { registerLogin, browserCommand, openBrowser, spawnDetached } from "../../src/commands/login.js";
import {
  readCredentials,
  writeCredentials,
  credentialsPath,
  CREDENTIALS_VERSION,
  type Credentials,
} from "../../src/auth/store.js";

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

  it("warns that OCTEN_API_KEY shadows the credential it just wrote", async () => {
    const h = tmp();
    const fetchImpl = tokenAndKeyFetch();
    const openBrowser = autoCompleteBrowser();
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerLogin(prog, { home: h, env: { OCTEN_API_KEY: "env-key" }, fetchImpl: fetchImpl as any, openBrowser });

    await prog.parseAsync(["node", "octen", "login"]);

    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(err).toContain("OCTEN_API_KEY");
    expect(err).toMatch(/takes precedence/i);
    expect(err).toMatch(/unset/i);
    expect(err).not.toContain("env-key");
    expect(err).not.toContain("resolved-key");
  });

  it("does not warn about OCTEN_API_KEY when it is not set", async () => {
    const h = tmp();
    const fetchImpl = tokenAndKeyFetch();
    const openBrowser = autoCompleteBrowser();
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerLogin(prog, { home: h, env: {}, fetchImpl: fetchImpl as any, openBrowser });

    await prog.parseAsync(["node", "octen", "login"]);

    expect(stderrSpy.mock.calls.map((c) => String(c[0])).join("")).not.toContain("OCTEN_API_KEY");
  });

  it("--api-key warns too when OCTEN_API_KEY shadows the file it just wrote", async () => {
    const h = tmp();
    const fetchImpl = vi.fn();
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerLogin(prog, { home: h, env: { OCTEN_API_KEY: "env-key" }, fetchImpl: fetchImpl as any, openBrowser: vi.fn() });

    await prog.parseAsync(["node", "octen", "login", "--api-key", "manual-key"]);

    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(err).toContain("OCTEN_API_KEY");
    expect(err).toMatch(/takes precedence/i);
    expect(err).not.toContain("manual-key");
    expect(err).not.toContain("env-key");
    // Still zero network requests on this branch.
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
    // Pinned on a production path (F4): the scope reaches the real AS
    // verbatim, and a typo here is invisible until the first live link-up.
    expect(authorizeUrl.searchParams.get("scope")).toBe("octen:api_key");
    expect(authorizeUrl.searchParams.get("resource")).toBe("https://cli.octen.ai");

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

  it("proceeds and overwrites a corrupt existing credentials file", async () => {
    // octen login is precisely the command that must not depend on the old
    // file being readable — it's about to overwrite it at step 8 regardless.
    const h = tmp();
    mkdirSync(join(h, ".octen"), { recursive: true });
    writeFileSync(credentialsPath(h), "{ not valid json", "utf8");

    const fetchImpl = tokenAndKeyFetch();
    const openBrowser = autoCompleteBrowser();
    const prog = baseProgram();
    registerLogin(prog, { home: h, fetchImpl: fetchImpl as any, openBrowser });
    await prog.parseAsync(["node", "octen", "login"]);

    expect(readCredentials(h)).toMatchObject({ source: "login", apiKey: "resolved-key" });
  });

  it("proceeds and overwrites a credentials file with an unrecognized version", async () => {
    // Simulates the day CREDENTIALS_VERSION bumps: an upgraded user's old
    // file must not become unrecoverable via the one command meant to fix it.
    const h = tmp();
    mkdirSync(join(h, ".octen"), { recursive: true });
    writeFileSync(
      credentialsPath(h),
      JSON.stringify({ version: 99, source: "login", apiKey: "old" }),
      "utf8",
    );

    const fetchImpl = tokenAndKeyFetch();
    const openBrowser = autoCompleteBrowser();
    const prog = baseProgram();
    registerLogin(prog, { home: h, fetchImpl: fetchImpl as any, openBrowser });
    await prog.parseAsync(["node", "octen", "login"]);

    expect(readCredentials(h)).toMatchObject({ source: "login", apiKey: "resolved-key" });
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
    const openBrowserSpy = autoCompleteBrowser();
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerLogin(prog, { home: h, fetchImpl: fetchImpl as any, openBrowser: openBrowserSpy });
    await prog.parseAsync(["node", "octen", "login"]);

    // stdout carries EXACTLY the single final confirmation line — nothing
    // else. A regression that moved a progress line to stdout (or dropped
    // the confirmation, or duplicated it) fails this.
    expect(stdoutSpy.mock.calls).toEqual([
      [`Logged in as acct-1. Credentials saved to ${credentialsPath(h)}\n`],
    ]);
    expect(stderrSpy.mock.calls.length).toBeGreaterThan(0);
  });

  it("builds a Windows command that survives & in the URL", () => {
    const url = "https://auth.octen.ai/oauth/authorize?a=1&b=2&state=x";
    expect(browserCommand("win32", url)).toEqual(["rundll32", ["url.dll,FileProtocolHandler", url]]);
    expect(browserCommand("darwin", url)).toEqual(["open", [url]]);
    expect(browserCommand("linux", url)).toEqual(["xdg-open", [url]]);
  });

  it("spawnDetached: a real async ENOENT (missing binary) does not crash the process and calls onFailure", async () => {
    // This is the real `child_process.spawn`, not a mock — a missing binary
    // fails asynchronously via the child's 'error' event, not a synchronous
    // throw. If `spawnDetached` failed to attach an 'error' listener, that
    // event would be an unhandled exception and this test process would
    // crash rather than merely fail the assertion below.
    const onFailure = vi.fn();
    spawnDetached("octen-cli-test-nonexistent-binary-9f3e7c21", [], onFailure);

    await vi.waitFor(() => {
      expect(onFailure).toHaveBeenCalledTimes(1);
    });
    const err = onFailure.mock.calls[0][0] as NodeJS.ErrnoException;
    expect(err.code).toBe("ENOENT");
  });

  it("openBrowser: an async spawn failure falls back via onFailure, not a synchronous throw", async () => {
    // The bug this pins: the original implementation had no 'error'
    // listener at all, so this failure mode (the realistic one) went
    // completely uncaught. A test that only injects a synchronous throw
    // (see "falls back to printing the URL...", above) cannot catch that.
    //
    // This drives the REAL openBrowser -> spawnDetached -> spawn path (no
    // mocking) but forces a guaranteed-nonexistent command via the optional
    // `resolveCommand` override, rather than relying on a real platform
    // opener (xdg-open here) being absent from whatever machine happens to
    // run this suite — plenty of Linux desktops ship xdg-utils, and running
    // against the real thing risked either a slow timeout-and-fail there or,
    // worse, actually opening a browser window mid-test-run.
    const onFailure = vi.fn();
    const resolveNonexistentCommand = (): [string, string[]] => [
      "octen-cli-test-nonexistent-binary-2a71fd",
      [],
    ];
    expect(() =>
      openBrowser("https://auth.octen.ai/x", onFailure, process.platform, resolveNonexistentCommand),
    ).not.toThrow();

    await vi.waitFor(() => {
      expect(onFailure).toHaveBeenCalledTimes(1);
    });
  });

  it("a failed exchange leaves no partial credential file (first login)", async () => {
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

  it("a failed exchange during a re-login leaves the previous credential file untouched", async () => {
    // Disk state after a failure differs by starting state: a first login
    // leaves nothing (above); a re-login leaves the OLD file exactly as it
    // was — never deleted, never partially overwritten — even though step 1
    // already revoked its grant server-side. The stored key still works (the
    // server only flips the grant's status, never the key's), so this is a
    // still-working credential whose grantId now names a vanished grant, not
    // a dead one.
    const h = tmp();
    const oldCreds: Credentials = {
      version: CREDENTIALS_VERSION,
      source: "login",
      issuer: "https://auth.octen.ai",
      resource: "https://cli.octen.ai",
      apiKey: "old-key",
      apiKeyExpiresAt: null,
      grantId: "old-grant",
    };
    writeCredentials(h, oldCreds);

    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith("/api/oauth/cli/revoke")) return new Response("{}", { status: 200 });
      if (u.endsWith("/api/oauth/token")) return new Response(JSON.stringify({ access_token: "at-1" }), { status: 200 });
      if (u.endsWith("/api/oauth/cli/key")) return new Response("{}", { status: 503 });
      throw new Error(`unexpected fetch to ${u}`);
    });
    const openBrowser = autoCompleteBrowser();
    const prog = baseProgram();
    registerLogin(prog, { home: h, fetchImpl: fetchImpl as any, openBrowser });

    await expect(prog.parseAsync(["node", "octen", "login"])).rejects.toThrow();
    expect(readCredentials(h)).toEqual(oldCreds);
  });

  it("rejects --port 0 (would silently pick a random port, defeating ssh -L pinning)", async () => {
    const h = tmp();
    const prog = baseProgram();
    registerLogin(prog, { home: h, fetchImpl: vi.fn() as any, openBrowser: vi.fn() });
    await expect(prog.parseAsync(["node", "octen", "login", "--port", "0"])).rejects.toThrow(
      /--port must be 1-65535/,
    );
  });

  it("rejects --port above the valid TCP port range", async () => {
    const h = tmp();
    const prog = baseProgram();
    registerLogin(prog, { home: h, fetchImpl: vi.fn() as any, openBrowser: vi.fn() });
    await expect(prog.parseAsync(["node", "octen", "login", "--port", "65536"])).rejects.toThrow(
      /--port must be 1-65535/,
    );
  });
});
