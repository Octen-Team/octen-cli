import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
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
});

function makeProgram(home: string, cwd: string) {
  const prog = new Command();
  prog
    .name("octen")
    .option("--api-key <key>", "Octen API key")
    .option("--base-url <url>", "API base URL")
    .option("--json", "raw JSON output")
    .option("--pretty", "human-readable output")
    .exitOverride();
  // Inject temp dirs and disable claude CLI to avoid real side effects
  registerConfigureMcp(prog, { home, cwd, hasClaudeCli: false });
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
