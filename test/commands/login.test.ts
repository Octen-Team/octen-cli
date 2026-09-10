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
function tokenAndKeyFetch(accountName?: string) {
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
          // Omitted unless a test asks for it: that is what prod and any
          // server older than the field actually send.
          ...(accountName !== undefined ? { account_name: accountName } : {}),
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

  it("--api-key warns with the grantId when it overwrites a source=login credential", async () => {
    // This branch destroys the only record of the grantId on this
    // machine and previously said nothing but "API key saved.", leaving the
    // authorization listed in the dashboard with nothing able to name it.
    const h = tmp();
    writeCredentials(h, {
      version: CREDENTIALS_VERSION,
      source: "login",
      issuer: "https://auth.octen.ai",
      resource: "https://cli.octen.ai",
      apiKey: "sk-must-not-leak",
      apiKeyExpiresAt: null,
      grantId: "grant-overwritten",
    });
    const fetchImpl = vi.fn();
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerLogin(prog, { home: h, env: {}, fetchImpl: fetchImpl as any, openBrowser: vi.fn() });

    await prog.parseAsync(["node", "octen", "login", "--api-key", "manual-key"]);

    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(err).toContain("grant-overwritten");
    expect(err).toMatch(/dashboard/i);
    expect(err).not.toContain("sk-must-not-leak");
    expect(err).not.toContain("manual-key");
    // The zero-network rule for this branch is preserved.
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(readCredentials(h)).toMatchObject({ source: "api-key", apiKey: "manual-key" });
  });

  it("--api-key says nothing about a grant when overwriting an api-key credential", async () => {
    const h = tmp();
    writeCredentials(h, { version: CREDENTIALS_VERSION, source: "api-key", apiKey: "old" });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerLogin(prog, { home: h, env: {}, fetchImpl: vi.fn() as any, openBrowser: vi.fn() });

    await prog.parseAsync(["node", "octen", "login", "--api-key", "manual-key"]);

    expect(stderrSpy.mock.calls.map((c) => String(c[0])).join("")).not.toMatch(/grant|dashboard/i);
  });

  it("--api-key tolerates an unreadable credentials file and still stores the key", async () => {
    const h = tmp();
    mkdirSync(join(h, ".octen"), { recursive: true });
    writeFileSync(join(h, ".octen/credentials.json"), "{ not json");
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerLogin(prog, { home: h, env: {}, fetchImpl: vi.fn() as any, openBrowser: vi.fn() });

    await prog.parseAsync(["node", "octen", "login", "--api-key", "manual-key"]);

    expect(readCredentials(h)).toMatchObject({ source: "api-key", apiKey: "manual-key" });
  });

  it("--help documents OCTEN_AUTH_ISSUER and OCTEN_AUTH_RESOURCE", () => {
    // Both variables can make every command say "No API key" while a
    // good credential sits on disk, and a trailing slash on either throws.
    // They must be findable from the CLI itself, not just the README.
    const prog = baseProgram();
    registerLogin(prog, { home: tmp(), env: {} });
    const loginCmd = prog.commands.find((c) => c.name() === "login")!;
    // helpInformation() renders only the built-in sections; the
    // addHelpText("after") hook is applied by outputHelp().
    let help = "";
    loginCmd.configureOutput({ writeOut: (str) => { help += str; } });
    loginCmd.outputHelp();
    expect(help).toContain("OCTEN_AUTH_ISSUER");
    expect(help).toContain("OCTEN_AUTH_RESOURCE");
    expect(help).toMatch(/trailing slash/);
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
    // Pinned on a production path: the scope reaches the real AS
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

  // 这条钉住的是一个实测出过的泄漏：凭证文件里的 issuer 会被无条件信任，
  // step 1 把账户级长期 API key 发给它——而 config/resolve.ts 对同一份凭证的
  // 判断是"不属于本环境、绝不使用"。不用它调 API 却肯把 key 交给它，是同一个
  // 凭证在唯一会泄漏的方向上被信任。
  it("does NOT revoke — or send the key to — a credential from a different issuer", async () => {
    const h = tmp();
    writeCredentials(h, {
      version: CREDENTIALS_VERSION,
      source: "login",
      issuer: "http://127.0.0.1:9911",
      resource: "https://cli.octen.ai",
      apiKey: "sk-other-environment-must-not-leak",
      apiKeyExpiresAt: null,
      grantId: "grant-other-environment",
    });

    const touchedHosts: string[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      touchedHosts.push(new URL(u).host);
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
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerLogin(prog, { home: h, fetchImpl: fetchImpl as any, openBrowser: autoCompleteBrowser() });
    await prog.parseAsync(["node", "octen", "login"]);

    // 没有任何一次请求打到那个 issuer。
    expect(touchedHosts).not.toContain("127.0.0.1:9911");
    const bodies = fetchImpl.mock.calls.map((c) => JSON.stringify(c[1] ?? {})).join("");
    expect(bodies).not.toContain("sk-other-environment-must-not-leak");

    // 而且必须明确告诉用户那条 grant 没被撤销、以及它的 id ——
    // 下一行就要覆盖掉这台机器上唯一记着这个 id 的地方。
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(err).toContain("grant-other-environment");
    expect(err).toContain("http://127.0.0.1:9911");
    expect(err).toMatch(/NOT revoked/i);
    expect(err).not.toContain("sk-other-environment-must-not-leak");

    // 新登录本身照常完成。
    expect(readCredentials(h)).toMatchObject({ grantId: "new-grant", apiKey: "new-key" });
  });

  it("does NOT revoke a credential whose audience differs from this login's", async () => {
    const h = tmp();
    writeCredentials(h, {
      version: CREDENTIALS_VERSION,
      source: "login",
      issuer: "https://auth.octen.ai",
      resource: "https://cli.other.example",
      apiKey: "sk-other-audience",
      apiKeyExpiresAt: null,
      grantId: "grant-other-audience",
    });
    const revoked: string[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith("/api/oauth/cli/revoke")) {
        revoked.push(u);
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
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerLogin(prog, { home: h, fetchImpl: fetchImpl as any, openBrowser: autoCompleteBrowser() });
    await prog.parseAsync(["node", "octen", "login"]);

    expect(revoked).toEqual([]);
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(err).toContain("grant-other-audience");
    expect(err).toMatch(/NOT revoked/i);
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
    // The warning must name the grant. The file that held "old-grant" has
    // just been overwritten with "new-grant", so if this line omits the id
    // the user has no way left to identify the authorization still sitting
    // in the dashboard.
    expect(stderrOutput).toContain("old-grant");
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

  // The confirmation line prefers the server's human-readable account name and
  // falls back to the raw account id. Both halves matter: the fallback is what
  // every user sees against prod until the server side of this ships, and what
  // anyone sees when the name could not be loaded.
  it("names the account by its label when the server sends one", async () => {
    const h = tmp();
    const fetchImpl = tokenAndKeyFetch("Octen family");
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerLogin(prog, { home: h, fetchImpl: fetchImpl as any, openBrowser: autoCompleteBrowser() });
    await prog.parseAsync(["node", "octen", "login"]);

    expect(stdoutSpy.mock.calls).toEqual([
      [`Logged in as Octen family. Credentials saved to ${credentialsPath(h)}\n`],
    ]);
    // Display-only: the name must not reach the credential file, or a renamed
    // organization would keep showing its old name until the next login.
    expect(readCredentials(h)).not.toHaveProperty("accountName");
    expect(readCredentials(h)).toMatchObject({ accountId: "acct-1" });
  });

  it("falls back to the account id when the server sends no label", async () => {
    const h = tmp();
    const fetchImpl = tokenAndKeyFetch();
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerLogin(prog, { home: h, fetchImpl: fetchImpl as any, openBrowser: autoCompleteBrowser() });
    await prog.parseAsync(["node", "octen", "login"]);

    expect(stdoutSpy.mock.calls).toEqual([
      [`Logged in as acct-1. Credentials saved to ${credentialsPath(h)}\n`],
    ]);
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
