import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Command } from "commander";
import { registerLogout } from "../../src/commands/logout.js";
import { readCredentials, writeCredentials, credentialsPath, CREDENTIALS_VERSION } from "../../src/auth/store.js";

let tmpDirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "octen-logout-cmd-"));
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

function seedLoginCreds(h: string, over: Partial<Record<string, unknown>> = {}) {
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
    ...over,
  } as any);
}

async function runLogout(h: string, fetchImpl: any, args: string[] = []): Promise<{ out: string; err: string }> {
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const prog = baseProgram();
  registerLogout(prog, { home: h, fetchImpl });
  await prog.parseAsync(["node", "octen", "logout", ...args]);
  return {
    out: stdoutSpy.mock.calls.map((c) => String(c[0])).join(""),
    err: stderrSpy.mock.calls.map((c) => String(c[0])).join(""),
  };
}

describe("octen logout", () => {
  it("revokes via /api/oauth/cli/revoke then deletes the file", async () => {
    const h = tmp();
    seedLoginCreds(h);
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://auth.octen.ai/api/oauth/cli/revoke");
      expect(String(url)).not.toBe("https://auth.octen.ai/api/oauth/revoke");
      expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("the-real-key");
      expect(JSON.parse(String(init?.body))).toEqual({ grant_id: "grant-abc" });
      return new Response("{}", { status: 200 });
    });

    const { out } = await runLogout(h, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(readCredentials(h)).toBeUndefined();
    // Positive assertion, not just "doesn't say the bad thing": the honest
    // caveat must still be present. Deleting this sentence entirely used to
    // pass every other test in this file.
    expect(out).toMatch(/does not deactivate the api key/i);
  });

  it("still works long after a refresh token would have expired", async () => {
    // The reason this revocation scheme exists at all: there is no
    // refreshToken on disk — revocation uses only apiKey + grantId, and the
    // API key does not expire, so elapsed time since
    // login (even far past a hypothetical 30-day refresh-token lifetime)
    // never affects it.
    const h = tmp();
    seedLoginCreds(h);
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));

    await runLogout(h, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(readCredentials(h)).toBeUndefined();
  });

  it("--local skips the network call, prints the grantId, and never suggests the now-unreachable plain logout", async () => {
    const h = tmp();
    seedLoginCreds(h, { grantId: "grant-local-test" });
    const fetchImpl = vi.fn();

    const { out } = await runLogout(h, fetchImpl, ["--local"]);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(readCredentials(h)).toBeUndefined();
    // The file is already gone by the time this prints, so "run `octen
    // logout` without --local" would land on the no-credential branch and
    // never work — and without the grantId printed here, the user has no
    // way left to identify which authorization to revoke in the dashboard.
    expect(out).toContain("grant-local-test");
    expect(out).not.toMatch(/run `octen logout` without --local/);
  });

  it("on an api-key credential deletes the file without claiming a revocation, with zero network requests", async () => {
    const h = tmp();
    writeCredentials(h, { version: CREDENTIALS_VERSION, source: "api-key", apiKey: "pasted-key" });
    const fetchImpl = vi.fn();

    const { out } = await runLogout(h, fetchImpl);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(readCredentials(h)).toBeUndefined();
    // Broad enough to catch "revoke", "revoking", "revocation" — not just
    // the exact word "revoked" that a narrower regex would miss.
    expect(out).not.toMatch(/revok|撤销/i);
  });

  it("keeps the file when revocation fails for a network reason and suggests --local", async () => {
    const h = tmp();
    seedLoginCreds(h);
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });

    const { err } = await runLogout(h, fetchImpl);

    // Not deleted: a failed revocation does not mean the credential is invalid.
    expect(readCredentials(h)).toMatchObject({ source: "login", grantId: "grant-abc" });
    expect(existsSync(credentialsPath(h))).toBe(true);
    expect(err).toMatch(/--local/);
    expect(process.exitCode).toBe(1);
  });

  it("deletes the file when the server says the grant id was not recognized (400) — the goal is already met", async () => {
    const h = tmp();
    seedLoginCreds(h, { grantId: "grant-400" });
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 400 }));

    const { out, err } = await runLogout(h, fetchImpl);

    // Deterministic failure: retrying plain `octen logout` would fail
    // identically forever, and the grant is already gone server-side — so
    // this must NOT be treated like the network-failure "keep the file" case.
    expect(readCredentials(h)).toBeUndefined();
    expect(process.exitCode).toBeUndefined();
    expect(out).toMatch(/already gone/i);
    expect(out).toContain("grant-400");
    expect(err).toBe("");
  });

  it("deletes the file when the stored key is no longer valid (401) and prints the grantId", async () => {
    const h = tmp();
    seedLoginCreds(h, { grantId: "grant-401" });
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 401 }));

    const { out } = await runLogout(h, fetchImpl);

    expect(readCredentials(h)).toBeUndefined();
    expect(process.exitCode).toBeUndefined();
    expect(out).toContain("grant-401");
    expect(out).not.toMatch(/already gone/i);
  });

  it("deletes the file when the grant isn't bound to this key (403) and prints the grantId", async () => {
    const h = tmp();
    seedLoginCreds(h, { grantId: "grant-403" });
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 403 }));

    const { out } = await runLogout(h, fetchImpl);

    expect(readCredentials(h)).toBeUndefined();
    expect(process.exitCode).toBeUndefined();
    expect(out).toContain("grant-403");
    expect(out).not.toMatch(/already gone/i);
  });

  it("removes an unreadable (corrupt) credentials file instead of failing, with zero network requests", async () => {
    const h = tmp();
    mkdirSync(join(h, ".octen"), { recursive: true });
    writeFileSync(credentialsPath(h), "{ not valid json", "utf8");
    const fetchImpl = vi.fn();

    const { out } = await runLogout(h, fetchImpl);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(existsSync(credentialsPath(h))).toBe(false);
    expect(out).toMatch(/cleared local credentials/i);
  });

  it("--local also removes an unreadable (corrupt) credentials file", async () => {
    const h = tmp();
    mkdirSync(join(h, ".octen"), { recursive: true });
    writeFileSync(credentialsPath(h), JSON.stringify({ version: 99, source: "login" }), "utf8");
    const fetchImpl = vi.fn();

    const { out } = await runLogout(h, fetchImpl, ["--local"]);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(existsSync(credentialsPath(h))).toBe(false);
    expect(out).toMatch(/cleared local credentials/i);
  });

  it("output never claims to have revoked access on other machines", async () => {
    const h = tmp();
    seedLoginCreds(h);
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));

    const { out } = await runLogout(h, fetchImpl);

    expect(out).not.toMatch(/撤销访问|revoked access/);
  });
});
