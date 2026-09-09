import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Command } from "commander";
import { registerWhoami } from "../../src/commands/whoami.js";
import { writeCredentials, CREDENTIALS_VERSION } from "../../src/auth/store.js";

let tmpDirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "octen-whoami-cmd-"));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
  process.exitCode = undefined;
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

describe("octen whoami", () => {
  it("reads only the local file and says so, with zero network requests", async () => {
    const h = tmp();
    writeCredentials(h, {
      version: CREDENTIALS_VERSION,
      source: "login",
      issuer: "https://auth.octen.ai",
      resource: "https://cli.octen.ai",
      apiKey: "the-real-key",
      apiKeyExpiresAt: null,
      grantId: "grant-abc",
      accountId: "acct-1",
      accountType: "user",
    });
    const fetchImpl = vi.fn();
    const globalFetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(fetchImpl as any);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerWhoami(prog, { home: h });

    // Force pretty rendering explicitly: whether the default is pretty or
    // JSON depends on process.stdout.isTTY, which is not a TTY under the
    // test runner — this test is about the annotated human-readable copy.
    await prog.parseAsync(["node", "octen", "whoami", "--pretty"]);

    expect(globalFetchSpy).not.toHaveBeenCalled();
    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toMatch(/local/i);
    expect(out).not.toContain("the-real-key");
  });

  it("--json emits machine-readable output", async () => {
    const h = tmp();
    writeCredentials(h, {
      version: CREDENTIALS_VERSION,
      source: "login",
      issuer: "https://auth.octen.ai",
      resource: "https://cli.octen.ai",
      apiKey: "the-real-key",
      apiKeyExpiresAt: null,
      grantId: "grant-abc",
      accountId: "acct-1",
      accountType: "user",
    });
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerWhoami(prog, { home: h });

    await prog.parseAsync(["node", "octen", "whoami", "--json"]);

    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(out);
    expect(parsed).toMatchObject({
      loggedIn: true,
      source: "login",
      grantId: "grant-abc",
      accountId: "acct-1",
      accountType: "user",
      apiKeyExpiresAt: null,
    });
    expect(JSON.stringify(parsed)).not.toContain("the-real-key");
  });

  it("reports clearly when not logged in and exits non-zero", async () => {
    const h = tmp();
    const prog = baseProgram();
    registerWhoami(prog, { home: h });

    await expect(prog.parseAsync(["node", "octen", "whoami"])).rejects.toThrow(/not logged in/i);
  });

  it("on an api-key credential shows the source and no account fields", async () => {
    const h = tmp();
    writeCredentials(h, { version: CREDENTIALS_VERSION, source: "api-key", apiKey: "pasted-key" });
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerWhoami(prog, { home: h });

    await prog.parseAsync(["node", "octen", "whoami", "--json"]);

    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    const parsed = JSON.parse(out);
    expect(parsed.source).toBe("api-key");
    expect(parsed).not.toHaveProperty("accountId");
    expect(parsed).not.toHaveProperty("grantId");
    expect(JSON.stringify(parsed)).not.toContain("pasted-key");
  });

  it("prints the grantId so the user can find this device in the dashboard", async () => {
    const h = tmp();
    writeCredentials(h, {
      version: CREDENTIALS_VERSION,
      source: "login",
      issuer: "https://auth.octen.ai",
      resource: "https://cli.octen.ai",
      apiKey: "the-real-key",
      apiKeyExpiresAt: null,
      grantId: "grant-xyz-123",
    });
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerWhoami(prog, { home: h });

    await prog.parseAsync(["node", "octen", "whoami"]);

    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toContain("grant-xyz-123");
  });
});
