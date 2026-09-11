import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Command } from "commander";
import { registerConfigureMcp } from "../../src/commands/configureMcp.js";
import { writeCredentials, CREDENTIALS_VERSION } from "../../src/auth/store.js";

let tmpDir: string;

function makeTmp() {
  tmpDir = mkdtempSync(join(tmpdir(), "octen-cmd-"));
  return tmpDir;
}

afterEach(() => {
  vi.restoreAllMocks();
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = "";
  }
  // Reset exit code so a failure path doesn't leak into other tests.
  process.exitCode = undefined;
});

function makeProgram(
  home: string,
  cwd: string,
  isInstalled: (id: string) => boolean = () => true,
) {
  const prog = new Command();
  prog
    .name("octen")
    .option("--api-key <key>", "Octen API key")
    .option("--base-url <url>", "API base URL")
    .option("--json", "raw JSON output")
    .option("--pretty", "human-readable output")
    .exitOverride();
  // Inject temp dirs and disable claude CLI to avoid real side effects
  registerConfigureMcp(prog, { home, cwd, hasClaudeCli: false, isInstalled });
  return prog;
}

describe("configure-mcp --cursor", () => {
  it("writes cursor mcp.json in temp home with octen entry", async () => {
    const home = makeTmp();
    const cwd = home;

    const prog = makeProgram(home, cwd);
    await prog.parseAsync([
      "node", "octen", "configure-mcp", "--cursor", "--api-key", "k",
    ]);

    const filePath = join(home, ".cursor/mcp.json");
    const obj = JSON.parse(readFileSync(filePath, "utf8"));
    expect(obj.mcpServers.octen.command).toBe("npx");
    expect(obj.mcpServers.octen.args).toContain("octen-mcp");
    expect(obj.mcpServers.octen.env.OCTEN_API_KEY).toBe("k");
  });

  it("pins the version when --pin is provided", async () => {
    const home = makeTmp();
    const prog = makeProgram(home, home);
    await prog.parseAsync([
      "node", "octen", "configure-mcp", "--cursor", "--api-key", "k", "--pin", "0.2.1",
    ]);

    const filePath = join(home, ".cursor/mcp.json");
    const obj = JSON.parse(readFileSync(filePath, "utf8"));
    expect(obj.mcpServers.octen.args).toContain("octen-mcp@0.2.1");
  });
});

describe("configure-mcp --codex", () => {
  it("writes codex TOML config with octen entry", async () => {
    const home = makeTmp();
    const prog = makeProgram(home, home);
    await prog.parseAsync([
      "node", "octen", "configure-mcp", "--codex", "--api-key", "k",
    ]);

    const filePath = join(home, ".codex/config.toml");
    const { parse: tomlParse } = await import("smol-toml");
    const parsed = tomlParse(readFileSync(filePath, "utf8")) as Record<string, any>;
    expect(parsed.mcp_servers.octen.command).toBe("npx");
    expect(parsed.mcp_servers.octen.env.OCTEN_API_KEY).toBe("k");
  });
});

describe("configure-mcp --claude-code", () => {
  it("writes ~/.claude.json when claude CLI not available", async () => {
    const home = makeTmp();
    const prog = makeProgram(home, home);
    await prog.parseAsync([
      "node", "octen", "configure-mcp", "--claude-code", "--api-key", "k",
    ]);

    const filePath = join(home, ".claude.json");
    const obj = JSON.parse(readFileSync(filePath, "utf8"));
    expect(obj.mcpServers.octen.command).toBe("npx");
  });
});

describe("configure-mcp --all", () => {
  it("writes config for every client", async () => {
    const home = makeTmp();
    const prog = makeProgram(home, home);
    await prog.parseAsync([
      "node", "octen", "configure-mcp", "--all", "--api-key", "k",
    ]);

    // Cursor user path
    const cursorPath = join(home, ".cursor/mcp.json");
    const cursor = JSON.parse(readFileSync(cursorPath, "utf8"));
    expect(cursor.mcpServers.octen).toBeDefined();

    // Codex TOML
    const { parse: tomlParse } = await import("smol-toml");
    const codexPath = join(home, ".codex/config.toml");
    const codex = tomlParse(readFileSync(codexPath, "utf8")) as Record<string, any>;
    expect(codex.mcp_servers.octen).toBeDefined();
  });
});

describe("configure-mcp status mode (no client flags)", () => {
  it("prints status for each client without throwing", async () => {
    const home = makeTmp();
    const prog = makeProgram(home, home);

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await prog.parseAsync(["node", "octen", "configure-mcp", "--api-key", "k"]);

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    // Should mention all 6 clients by label
    expect(output).toMatch(/Claude Code/);
    expect(output).toMatch(/Cursor/);
    expect(output).toMatch(/Codex/);
    expect(output).toMatch(/Windsurf/);
    // All should be absent (temp dir is empty)
    expect(output).toMatch(/absent/);
  });
});

describe("configure-mcp per-client error isolation", () => {
  it("one client fails, the other is still configured, warns to stderr, exitCode=1", async () => {
    const home = makeTmp();

    // FAILING client: cursor. Pre-create ~/.cursor/mcp.json as a DIRECTORY so
    // upsertMcpServer's readJsonFile() (existsSync true) then readFileSync()
    // throws EISDIR.
    mkdirSync(join(home, ".cursor/mcp.json"), { recursive: true });

    const prog = makeProgram(home, home);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    // HEALTHY client: claude-desktop (writes a fresh JSON file).
    await prog.parseAsync([
      "node", "octen", "configure-mcp", "--cursor", "--claude-desktop", "--api-key", "k",
    ]);

    // (a) Healthy client still configured: file written with octen entry.
    const desktopPath = join(home, "Library/Application Support/Claude/claude_desktop_config.json");
    const desktopCfg = JSON.parse(readFileSync(desktopPath, "utf8"));
    expect(desktopCfg.mcpServers.octen.command).toBe("npx");

    // (b) Warning written to stderr for the failing client.
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toMatch(/error configuring Cursor/);

    // (c) Exit code set to 1.
    expect(process.exitCode).toBe(1);
  });
});

describe("configure-mcp client-installed detection", () => {
  it("--cursor with client not installed writes nothing and warns", async () => {
    const home = makeTmp();
    const prog = makeProgram(home, home, () => false);

    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await prog.parseAsync([
      "node", "octen", "configure-mcp", "--cursor", "--api-key", "k",
    ]);

    // No file should be written.
    expect(existsSync(join(home, ".cursor/mcp.json"))).toBe(false);

    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toMatch(/not detected/);
  });

  it("--cursor with --force configures even when client not detected", async () => {
    const home = makeTmp();
    const prog = makeProgram(home, home, () => false);

    await prog.parseAsync([
      "node", "octen", "configure-mcp", "--cursor", "--api-key", "k", "--force",
    ]);

    const obj = JSON.parse(readFileSync(join(home, ".cursor/mcp.json"), "utf8"));
    expect(obj.mcpServers.octen.command).toBe("npx");
  });

  it("--all configures only detected clients and prints skipped list", async () => {
    const home = makeTmp();
    const installedMap: Record<string, boolean> = {
      "claude-code": false,
      "claude-desktop": false,
      cursor: true,
      windsurf: false,
      vscode: false,
      codex: true,
    };
    const prog = makeProgram(home, home, (id) => installedMap[id] ?? false);

    const stdoutLines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdoutLines.push(String(chunk));
      return true;
    });

    await prog.parseAsync([
      "node", "octen", "configure-mcp", "--all", "--api-key", "k",
    ]);

    // Detected clients configured.
    expect(existsSync(join(home, ".cursor/mcp.json"))).toBe(true);
    expect(existsSync(join(home, ".codex/config.toml"))).toBe(true);
    // Undetected clients NOT configured.
    expect(existsSync(join(home, ".claude.json"))).toBe(false);
    expect(
      existsSync(
        join(home, "Library/Application Support/Claude/claude_desktop_config.json"),
      ),
    ).toBe(false);

    const output = stdoutLines.join("");
    expect(output).toMatch(/skipped \(not installed\):/);
  });
});

describe("configure-mcp credential resolution", () => {
  /** Clear the env vars that would short-circuit resolveApiKey before the file. */
  function withCleanAuthEnv<T>(fn: () => T): T {
    const saved = {
      OCTEN_API_KEY: process.env.OCTEN_API_KEY,
      OCTEN_AUTH_ISSUER: process.env.OCTEN_AUTH_ISSUER,
      OCTEN_AUTH_RESOURCE: process.env.OCTEN_AUTH_RESOURCE,
    };
    delete process.env.OCTEN_API_KEY;
    delete process.env.OCTEN_AUTH_ISSUER;
    delete process.env.OCTEN_AUTH_RESOURCE;
    try {
      return fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }

  it("reads the login credential from the injected home, not os.homedir()", async () => {
    const home = makeTmp();
    writeCredentials(home, {
      version: CREDENTIALS_VERSION,
      source: "login",
      issuer: "https://auth.octen.ai",
      resource: "https://cli.octen.ai",
      apiKey: "key-from-injected-home",
      apiKeyExpiresAt: null,
      grantId: "grant-1",
    });
    const prog = makeProgram(home, home);

    await withCleanAuthEnv(() => prog.parseAsync(["node", "octen", "configure-mcp", "--cursor"]));

    const obj = JSON.parse(readFileSync(join(home, ".cursor/mcp.json"), "utf8"));
    expect(obj.mcpServers.octen.env.OCTEN_API_KEY).toBe("key-from-injected-home");
  });

  it("a corrupt credentials file names itself instead of degrading to a placeholder", async () => {
    const home = makeTmp();
    mkdirSync(join(home, ".octen"), { recursive: true });
    writeFileSync(join(home, ".octen/credentials.json"), "{ not json");
    const prog = makeProgram(home, home);

    // This used to be swallowed by a bare catch, which silently produced a
    // ${OCTEN_API_KEY} placeholder config for a distinct, fixable problem.
    await withCleanAuthEnv(async () => {
      await expect(
        prog.parseAsync(["node", "octen", "configure-mcp", "--cursor"]),
      ).rejects.toThrow(/Invalid credentials file/);
    });

    expect(existsSync(join(home, ".cursor/mcp.json"))).toBe(false);
  });

  it("status mode does not consult credentials, so a corrupt file never fails it", async () => {
    // Narrowing the catch must not make the read-only status listing fail on
    // a broken file it never reads.
    const home = makeTmp();
    mkdirSync(join(home, ".octen"), { recursive: true });
    writeFileSync(join(home, ".octen/credentials.json"), "{ not json");
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const prog = makeProgram(home, home);

    await withCleanAuthEnv(() => prog.parseAsync(["node", "octen", "configure-mcp"]));

    expect(stdoutSpy.mock.calls.map((c) => String(c[0])).join("")).toMatch(/Cursor:/);
  });

  it("an issuer mismatch names itself instead of degrading to a placeholder", async () => {
    // Before the fix this printed "no API key found", wrote a placeholder
    // config and exited 0 — a user holding a perfectly usable credential was
    // told there was no key, and the actual cause (an OCTEN_AUTH_ISSUER
    // override) went unmentioned. The root cause was testing `instanceof
    // OctenAuthError`, which also matches expiry and issuer/resource mismatch;
    // only a total absence of credentials may degrade to the placeholder.
    const home = makeTmp();
    writeCredentials(home, {
      version: CREDENTIALS_VERSION,
      source: "login",
      issuer: "https://auth.octen.ai",
      resource: "https://cli.octen.ai",
      apiKey: "stored-and-perfectly-usable",
      apiKeyExpiresAt: null,
      grantId: "grant-1",
    });
    const prog = makeProgram(home, home);

    await withCleanAuthEnv(async () => {
      process.env.OCTEN_AUTH_ISSUER = "https://auth.example.test";
      await expect(
        prog.parseAsync(["node", "octen", "configure-mcp", "--cursor"]),
      ).rejects.toThrow(/OCTEN_AUTH_ISSUER/);
    });

    // And it must not leave a half-written config carrying the placeholder.
    const cfg = join(home, ".cursor/mcp.json");
    if (existsSync(cfg)) {
      expect(readFileSync(cfg, "utf8")).not.toContain("${OCTEN_API_KEY}");
    }
  });

  it("a trailing slash on OCTEN_AUTH_ISSUER names itself instead of being swallowed", async () => {
    const home = makeTmp();
    writeCredentials(home, {
      version: CREDENTIALS_VERSION,
      source: "login",
      issuer: "https://auth.octen.ai",
      resource: "https://cli.octen.ai",
      apiKey: "stored",
      apiKeyExpiresAt: null,
      grantId: "grant-1",
    });
    const prog = makeProgram(home, home);

    await withCleanAuthEnv(async () => {
      process.env.OCTEN_AUTH_ISSUER = "https://auth.octen.ai/";
      await expect(
        prog.parseAsync(["node", "octen", "configure-mcp", "--cursor"]),
      ).rejects.toThrow(/OCTEN_AUTH_ISSUER/);
    });
  });
});

describe("configure-mcp missing API key", () => {
  it("uses placeholder key and prints warning on stderr", async () => {
    const home = makeTmp();
    const prog = makeProgram(home, home);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    // Make sure OCTEN_API_KEY is not set
    const origKey = process.env.OCTEN_API_KEY;
    delete process.env.OCTEN_API_KEY;
    // No os.homedir spy is needed: configureMcp.ts now threads its injected
    // `home` into resolveApiKey, so this assertion is hermetic by
    // construction rather than by one remembered mock.

    try {
      await prog.parseAsync(["node", "octen", "configure-mcp", "--cursor"]);
    } finally {
      if (origKey !== undefined) process.env.OCTEN_API_KEY = origKey;
    }

    const cursorPath = join(home, ".cursor/mcp.json");
    const obj = JSON.parse(readFileSync(cursorPath, "utf8"));
    expect(obj.mcpServers.octen.env.OCTEN_API_KEY).toBe("${OCTEN_API_KEY}");

    const stderrOutput = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrOutput).toMatch(/warning/);
    expect(stderrOutput).toMatch(/OCTEN_API_KEY/);
  });
});

describe("configure-mcp --codex --scope project", () => {
  it("writes the project .codex/config.toml and leaves the global file absent", async () => {
    const home = makeTmp();
    const cwd = mkdtempSync(join(tmpdir(), "octen-proj-"));

    try {
      const prog = makeProgram(home, cwd);
      await prog.parseAsync([
        "node", "octen", "configure-mcp", "--codex", "--scope", "project",
        "--api-key", "test-key",
      ]);

      expect(existsSync(join(cwd, ".codex/config.toml"))).toBe(true);
      expect(existsSync(join(home, ".codex/config.toml"))).toBe(false);

      const { parse: tomlParse } = await import("smol-toml");
      const parsed = tomlParse(
        readFileSync(join(cwd, ".codex/config.toml"), "utf8"),
      ) as Record<string, any>;
      expect(parsed.mcp_servers.octen.command).toBe("npx");
      expect(parsed.mcp_servers.octen.env.OCTEN_API_KEY).toBe("test-key");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("reports project status from the project file, not the global one", async () => {
    const home = makeTmp();
    const cwd = mkdtempSync(join(tmpdir(), "octen-proj-"));

    try {
      // Configure the project file only.
      await makeProgram(home, cwd).parseAsync([
        "node", "octen", "configure-mcp", "--codex", "--scope", "project",
        "--api-key", "test-key",
      ]);

      const projectOut: string[] = [];
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        projectOut.push(String(chunk));
        return true;
      });
      await makeProgram(home, cwd).parseAsync([
        "node", "octen", "configure-mcp", "--scope", "project",
      ]);
      expect(projectOut.join("")).toMatch(/Codex: configured/);

      vi.restoreAllMocks();

      const userOut: string[] = [];
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        userOut.push(String(chunk));
        return true;
      });
      await makeProgram(home, cwd).parseAsync([
        "node", "octen", "configure-mcp", "--scope", "user",
      ]);
      expect(userOut.join("")).toMatch(/Codex: absent/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("configure-mcp --scope validation", () => {
  it("rejects an unknown scope instead of silently using user scope", async () => {
    const home = makeTmp();
    const cwd = mkdtempSync(join(tmpdir(), "octen-proj-"));

    try {
      const prog = makeProgram(home, cwd);
      await expect(
        prog.parseAsync([
          "node", "octen", "configure-mcp", "--codex", "--scope", "global",
          "--api-key", "test-key",
        ]),
      ).rejects.toThrow(/--scope must be one of: user, project/);

      // Neither scope's file may be created.
      expect(existsSync(join(cwd, ".codex/config.toml"))).toBe(false);
      expect(existsSync(join(home, ".codex/config.toml"))).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
