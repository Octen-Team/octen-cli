import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
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
    registerWhoami(prog, { home: h, env: {} });

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
    registerWhoami(prog, { home: h, env: {} });

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

  it("reports clearly when not logged in and exits non-zero — without throwing", async () => {
    const h = tmp();
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerWhoami(prog, { home: h, env: {} });

    // whoami no longer throws here. "Not logged in" is a state this command
    // exists to report, not a failure of the command; the non-zero exit code
    // carries that signal instead. Throwing also meant --json emitted nothing
    // at all, which is worse than useless to the scripts that parse it.
    let thrown: unknown;
    await prog.parseAsync(["node", "octen", "whoami", "--pretty"]).catch((err) => {
      thrown = err;
    });
    expect(thrown).toBeUndefined();
    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toMatch(/not logged in/i);
    expect(process.exitCode).toBe(2);
  });

  it("on an api-key credential shows the source and no account fields", async () => {
    const h = tmp();
    writeCredentials(h, { version: CREDENTIALS_VERSION, source: "api-key", apiKey: "pasted-key" });
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerWhoami(prog, { home: h, env: {} });

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
    registerWhoami(prog, { home: h, env: {} });

    await prog.parseAsync(["node", "octen", "whoami"]);

    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toContain("grant-xyz-123");
  });

  it("reports issuer and resource so a mismatch is diagnosable from the CLI", async () => {
    const h = tmp();
    writeCredentials(h, {
      version: CREDENTIALS_VERSION,
      source: "login",
      issuer: "https://auth.octen.ai",
      resource: "https://cli.octen.ai",
      apiKey: "the-real-key",
      apiKeyExpiresAt: null,
      grantId: "grant-abc",
    });
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerWhoami(prog, { home: h, env: {} });

    await prog.parseAsync(["node", "octen", "whoami", "--json"]);
    const json = JSON.parse(stdoutSpy.mock.calls.map((c) => String(c[0])).join(""));
    expect(json).toMatchObject({
      issuer: "https://auth.octen.ai",
      resource: "https://cli.octen.ai",
      inEffect: true,
      effectiveSource: "credentials-file",
    });
    expect(json).not.toHaveProperty("ignoredReason");

    stdoutSpy.mockClear();
    // A fresh Command: commander keeps parsed option values on the instance,
    // so re-parsing the same program would still carry --json.
    const prog2 = baseProgram();
    registerWhoami(prog2, { home: h, env: {} });
    await prog2.parseAsync(["node", "octen", "whoami", "--pretty"]);
    const pretty = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(pretty).toContain("https://auth.octen.ai");
    expect(pretty).toContain("https://cli.octen.ai");
  });

  it("says the stored credential is not in effect when OCTEN_API_KEY shadows it", async () => {
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
    });
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerWhoami(prog, { home: h, env: { OCTEN_API_KEY: "env-key" } });

    await prog.parseAsync(["node", "octen", "whoami", "--json"]);
    const json = JSON.parse(stdoutSpy.mock.calls.map((c) => String(c[0])).join(""));
    expect(json).toMatchObject({
      loggedIn: true,
      inEffect: false,
      ignoredReason: "env-shadowed",
      effectiveSource: "OCTEN_API_KEY",
    });
    expect(JSON.stringify(json)).not.toContain("env-key");

    stdoutSpy.mockClear();
    // A fresh Command: commander keeps parsed option values on the instance,
    // so re-parsing the same program would still carry --json.
    const prog2 = baseProgram();
    registerWhoami(prog2, { home: h, env: { OCTEN_API_KEY: "env-key" } });
    await prog2.parseAsync(["node", "octen", "whoami", "--pretty"]);
    const pretty = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(pretty).toContain("OCTEN_API_KEY");
    expect(pretty).toMatch(/In effect: no/);
    expect(pretty).not.toContain("env-key");
  });

  it("says the stored credential is not in effect when --api-key shadows it", async () => {
    const h = tmp();
    writeCredentials(h, { version: CREDENTIALS_VERSION, source: "api-key", apiKey: "pasted-key" });
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerWhoami(prog, { home: h, env: {} });

    await prog.parseAsync(["node", "octen", "whoami", "--json", "--api-key", "flag-key"]);
    const json = JSON.parse(stdoutSpy.mock.calls.map((c) => String(c[0])).join(""));
    expect(json).toMatchObject({
      loggedIn: true,
      inEffect: false,
      ignoredReason: "flag-shadowed",
      effectiveSource: "--api-key",
    });
    expect(JSON.stringify(json)).not.toContain("flag-key");
  });

  it("says the stored credential is ignored when OCTEN_AUTH_ISSUER selects another issuer", async () => {
    const h = tmp();
    writeCredentials(h, {
      version: CREDENTIALS_VERSION,
      source: "login",
      issuer: "https://auth.octen.ai",
      resource: "https://cli.octen.ai",
      apiKey: "the-real-key",
      apiKeyExpiresAt: null,
      grantId: "grant-abc",
    });
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerWhoami(prog, { home: h, env: { OCTEN_AUTH_ISSUER: "http://127.0.0.1:8080" } });

    await prog.parseAsync(["node", "octen", "whoami", "--json"]);
    const json = JSON.parse(stdoutSpy.mock.calls.map((c) => String(c[0])).join(""));
    expect(json).toMatchObject({
      loggedIn: true,
      inEffect: false,
      ignoredReason: "issuer-mismatch",
      effectiveSource: "none",
      issuer: "https://auth.octen.ai",
      expectedIssuer: "http://127.0.0.1:8080",
    });

    stdoutSpy.mockClear();
    // A fresh Command: commander keeps parsed option values on the instance,
    // so re-parsing the same program would still carry --json.
    const prog2 = baseProgram();
    registerWhoami(prog2, { home: h, env: { OCTEN_AUTH_ISSUER: "http://127.0.0.1:8080" } });
    await prog2.parseAsync(["node", "octen", "whoami", "--pretty"]);
    const pretty = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(pretty).toContain("OCTEN_AUTH_ISSUER");
    expect(pretty).toMatch(/In effect: no/);
  });

  it("says the stored credential is ignored when OCTEN_AUTH_RESOURCE selects another resource", async () => {
    const h = tmp();
    writeCredentials(h, {
      version: CREDENTIALS_VERSION,
      source: "login",
      issuer: "https://auth.octen.ai",
      resource: "https://cli.octen.ai",
      apiKey: "the-real-key",
      apiKeyExpiresAt: null,
      grantId: "grant-abc",
    });
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerWhoami(prog, { home: h, env: { OCTEN_AUTH_RESOURCE: "https://other.example" } });

    await prog.parseAsync(["node", "octen", "whoami", "--json"]);
    const json = JSON.parse(stdoutSpy.mock.calls.map((c) => String(c[0])).join(""));
    expect(json).toMatchObject({
      inEffect: false,
      ignoredReason: "resource-mismatch",
      expectedResource: "https://other.example",
    });
  });

  it("--json emits a loggedIn:false object rather than nothing when not logged in", async () => {
    const h = tmp();
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerWhoami(prog, { home: h, env: {} });

    await prog.parseAsync(["node", "octen", "whoami", "--json"]);

    const json = JSON.parse(stdoutSpy.mock.calls.map((c) => String(c[0])).join(""));
    expect(json).toEqual({ loggedIn: false, effectiveSource: "none" });
    expect(process.exitCode).toBe(2);
  });

  it("--json reports the env key as effective when there is no credential file", async () => {
    const h = tmp();
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerWhoami(prog, { home: h, env: { OCTEN_API_KEY: "env-key" } });

    await prog.parseAsync(["node", "octen", "whoami", "--json"]);

    const json = JSON.parse(stdoutSpy.mock.calls.map((c) => String(c[0])).join(""));
    expect(json).toEqual({ loggedIn: false, effectiveSource: "OCTEN_API_KEY" });
    expect(JSON.stringify(json)).not.toContain("env-key");
    // Exit 0: the exit code tracks "is a key in effect", not "does a file
    // exist". OCTEN_API_KEY is set, so every command works — exiting 2 here
    // (as this used to) made `octen whoami && octen search …` refuse to run a
    // search that would have succeeded.
    expect(process.exitCode).toBeUndefined();
  });

  it("exits non-zero when a credential exists but nothing is in effect", async () => {
    // The other half of the same inversion: this used to exit 0 while
    // reporting effectiveSource "none", i.e. while saying every command would
    // fail. `octen whoami && octen search …` was unreliable in both directions.
    const h = tmp();
    writeCredentials(h, {
      version: CREDENTIALS_VERSION,
      source: "login",
      issuer: "https://auth.octen.ai",
      resource: "https://cli.octen.ai",
      apiKey: "stored-key",
      apiKeyExpiresAt: null,
      grantId: "g-1",
    });
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerWhoami(prog, { home: h, env: { OCTEN_AUTH_ISSUER: "https://auth.example.test" } });

    await prog.parseAsync(["node", "octen", "whoami", "--json"]);

    const json = JSON.parse(stdoutSpy.mock.calls.map((c) => String(c[0])).join(""));
    expect(json).toMatchObject({ effectiveSource: "none", inEffect: false, ignoredReason: "issuer-mismatch" });
    expect(process.exitCode).toBe(2);
  });

  it("a corrupt credentials file does not fail whoami when a flag or env key is in effect", async () => {
    // resolveApiKey returns on the flag/env path without touching disk, so
    // `octen search` works fine here. whoami used to be the one command that
    // exited 2 on this input — and in --json mode emitted no JSON at all.
    const h = tmp();
    mkdirSync(join(h, ".octen"), { recursive: true });
    writeFileSync(join(h, ".octen", "credentials.json"), "{");
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerWhoami(prog, { home: h, env: { OCTEN_API_KEY: "env-key" } });

    await prog.parseAsync(["node", "octen", "whoami", "--json"]);

    const json = JSON.parse(stdoutSpy.mock.calls.map((c) => String(c[0])).join(""));
    expect(json).toEqual({ loggedIn: false, effectiveSource: "OCTEN_API_KEY" });
    expect(process.exitCode).toBeUndefined();
  });

  it("a corrupt credentials file STILL fails whoami when nothing shadows it", async () => {
    // The tolerance above is scoped to "the file is irrelevant anyway". With
    // no flag and no env key the file is the answer, so a corrupt one must
    // still name itself rather than be reported as "not logged in".
    const h = tmp();
    mkdirSync(join(h, ".octen"), { recursive: true });
    writeFileSync(join(h, ".octen", "credentials.json"), "{");
    const prog = baseProgram();
    registerWhoami(prog, { home: h, env: {} });

    let thrown: unknown;
    await prog.parseAsync(["node", "octen", "whoami", "--json"]).catch((err) => {
      thrown = err;
    });
    expect((thrown as Error | undefined)?.message).toMatch(/corrupt JSON/i);
  });

  it("makes zero network requests even when reporting a shadowed credential", async () => {
    const h = tmp();
    writeCredentials(h, {
      version: CREDENTIALS_VERSION,
      source: "login",
      issuer: "https://auth.octen.ai",
      resource: "https://cli.octen.ai",
      apiKey: "the-real-key",
      apiKeyExpiresAt: null,
      grantId: "grant-abc",
    });
    const globalFetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(vi.fn() as any);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const prog = baseProgram();
    registerWhoami(prog, { home: h, env: { OCTEN_API_KEY: "env-key", OCTEN_AUTH_ISSUER: "http://127.0.0.1:8080" } });

    await prog.parseAsync(["node", "octen", "whoami", "--json"]);
    expect(globalFetchSpy).not.toHaveBeenCalled();
  });
});
