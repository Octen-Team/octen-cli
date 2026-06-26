import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Command } from "commander";
import { registerConfigureMcp } from "../../src/commands/configureMcp.js";

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

describe("configure-mcp missing API key", () => {
  it("uses placeholder key and prints warning on stderr", async () => {
    const home = makeTmp();
    const prog = makeProgram(home, home);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    // Make sure OCTEN_API_KEY is not set
    const origKey = process.env.OCTEN_API_KEY;
    delete process.env.OCTEN_API_KEY;

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
