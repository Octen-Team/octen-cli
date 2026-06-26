import { describe, it, expect, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Command } from "commander";
import { registerReset } from "../../src/commands/reset.js";

let tmpDirs: string[] = [];

function makeTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "octen-reset-"));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const d of tmpDirs) {
    rmSync(d, { recursive: true, force: true });
  }
  tmpDirs = [];
  // Reset exit code
  process.exitCode = undefined;
});

function makeProgram(home: string, cwd: string) {
  const prog = new Command();
  prog
    .name("octen")
    .option("--api-key <key>", "Octen API key")
    .exitOverride();
  registerReset(prog, { home, cwd, hasClaudeCli: false });
  return prog;
}

describe("reset --cursor --mcp --skills", () => {
  it("removes octen from cursor mcp.json and octen-search skill dir while leaving others", async () => {
    const home = makeTmp();

    // Seed ~/.cursor/mcp.json with octen + other
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(
      join(home, ".cursor/mcp.json"),
      JSON.stringify({
        mcpServers: {
          octen: { command: "npx", args: ["-y", "octen-mcp"] },
          other: { command: "other-server" },
        },
      }),
      "utf8",
    );

    // Seed ~/.cursor/skills/ with octen-search and keepme
    const cursorSkillsDir = join(home, ".cursor/skills");
    mkdirSync(join(cursorSkillsDir, "octen-search"), { recursive: true });
    writeFileSync(join(cursorSkillsDir, "octen-search", "SKILL.md"), "# octen-search\n", "utf8");
    mkdirSync(join(cursorSkillsDir, "keepme"), { recursive: true });
    writeFileSync(join(cursorSkillsDir, "keepme", "SKILL.md"), "# keepme\n", "utf8");

    const prog = makeProgram(home, home);
    await prog.parseAsync(["node", "octen", "reset", "--cursor", "--mcp", "--skills"]);

    // MCP: octen removed, other survives
    const mcpConfig = JSON.parse(readFileSync(join(home, ".cursor/mcp.json"), "utf8"));
    expect(mcpConfig.mcpServers.octen).toBeUndefined();
    expect(mcpConfig.mcpServers.other).toBeDefined();

    // Skills: octen-search gone, keepme survives
    expect(existsSync(join(cursorSkillsDir, "octen-search"))).toBe(false);
    expect(existsSync(join(cursorSkillsDir, "keepme"))).toBe(true);
    expect(existsSync(join(cursorSkillsDir, "keepme", "SKILL.md"))).toBe(true);
  });
});

describe("reset with no surface flags", () => {
  it("prints guidance message, does not throw, does not modify files", async () => {
    const home = makeTmp();

    // Seed a cursor config so we can confirm it's untouched
    mkdirSync(join(home, ".cursor"), { recursive: true });
    const configContent = JSON.stringify({
      mcpServers: { octen: { command: "npx" } },
    });
    writeFileSync(join(home, ".cursor/mcp.json"), configContent, "utf8");

    const prog = makeProgram(home, home);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await prog.parseAsync(["node", "octen", "reset", "--cursor"]);

    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toMatch(/specify --mcp, --skills, or --all/);

    // Config was not modified
    const current = readFileSync(join(home, ".cursor/mcp.json"), "utf8");
    expect(current).toBe(configContent);
  });
});

describe("reset --all", () => {
  it("removes octen entries from all clients without throwing", async () => {
    const home = makeTmp();

    // Seed cursor mcp.json with octen
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(
      join(home, ".cursor/mcp.json"),
      JSON.stringify({ mcpServers: { octen: { command: "npx" }, keep: { command: "keep" } } }),
      "utf8",
    );

    // Seed cursor skills dir with an octen skill
    const cursorSkillsDir = join(home, ".cursor/skills");
    mkdirSync(join(cursorSkillsDir, "octen-search"), { recursive: true });
    writeFileSync(join(cursorSkillsDir, "octen-search", "SKILL.md"), "# octen\n", "utf8");

    // Seed claude-code skills dir with an octen skill
    const claudeSkillsDir = join(home, ".claude/skills");
    mkdirSync(join(claudeSkillsDir, "octen-web-search"), { recursive: true });
    writeFileSync(join(claudeSkillsDir, "octen-web-search", "SKILL.md"), "# octen\n", "utf8");

    const prog = makeProgram(home, home);
    await prog.parseAsync(["node", "octen", "reset", "--all"]);

    // Cursor MCP: octen gone, keep survives
    const mcpConfig = JSON.parse(readFileSync(join(home, ".cursor/mcp.json"), "utf8"));
    expect(mcpConfig.mcpServers.octen).toBeUndefined();
    expect(mcpConfig.mcpServers.keep).toBeDefined();

    // Cursor skills: octen-search gone
    expect(existsSync(join(cursorSkillsDir, "octen-search"))).toBe(false);

    // Claude Code skills: octen-web-search gone
    expect(existsSync(join(claudeSkillsDir, "octen-web-search"))).toBe(false);

    // Exit code should not be set to 1 (no failures)
    expect(process.exitCode).toBeUndefined();
  });

  it("handles clients with no octen entries gracefully without throwing", async () => {
    const home = makeTmp();
    // No configs seeded — all clients should report 'not present' or 'no octen skills'
    const prog = makeProgram(home, home);

    // Should not throw
    await expect(
      prog.parseAsync(["node", "octen", "reset", "--all"]),
    ).resolves.not.toThrow();

    expect(process.exitCode).toBeUndefined();
  });
});

describe("reset per-client error isolation", () => {
  it("MCP: one client fails, the other still has octen removed, warns to stderr, exitCode=1", async () => {
    const home = makeTmp();

    // FAILING client: cursor. Pre-create ~/.cursor/mcp.json as a DIRECTORY so
    // removeMcpServer's existsSync() is true but readFileSync() throws EISDIR.
    mkdirSync(join(home, ".cursor/mcp.json"), { recursive: true });

    // HEALTHY client: claude-desktop with a valid config containing octen.
    const desktopDir = join(home, "Library/Application Support/Claude");
    mkdirSync(desktopDir, { recursive: true });
    const desktopPath = join(desktopDir, "claude_desktop_config.json");
    writeFileSync(
      desktopPath,
      JSON.stringify({
        mcpServers: { octen: { command: "npx" }, keep: { command: "keep" } },
      }),
      "utf8",
    );

    const prog = makeProgram(home, home);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await prog.parseAsync([
      "node", "octen", "reset", "--mcp", "--cursor", "--claude-desktop",
    ]);

    // (a) Healthy client processed: octen removed, keep survives.
    const desktopCfg = JSON.parse(readFileSync(desktopPath, "utf8"));
    expect(desktopCfg.mcpServers.octen).toBeUndefined();
    expect(desktopCfg.mcpServers.keep).toBeDefined();

    // (b) Warning written to stderr for the failing client.
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toMatch(/warning: failed to remove MCP from Cursor/);

    // (c) Exit code set to 1.
    expect(process.exitCode).toBe(1);
  });

  it("skills: one client fails, the other still has skills removed, warns to stderr, exitCode=1", async () => {
    const home = makeTmp();

    // FAILING client: cursor. Pre-create ~/.cursor/skills as a FILE so
    // removeSkills' existsSync() is true but readdirSync() throws ENOTDIR.
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(join(home, ".cursor/skills"), "not a directory", "utf8");

    // HEALTHY client: claude-code with an octen skill in ~/.claude/skills.
    const claudeSkillsDir = join(home, ".claude/skills");
    mkdirSync(join(claudeSkillsDir, "octen-web-search"), { recursive: true });
    writeFileSync(join(claudeSkillsDir, "octen-web-search", "SKILL.md"), "# octen\n", "utf8");

    const prog = makeProgram(home, home);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await prog.parseAsync([
      "node", "octen", "reset", "--skills", "--cursor", "--claude-code",
    ]);

    // (a) Healthy client processed: octen-web-search removed.
    expect(existsSync(join(claudeSkillsDir, "octen-web-search"))).toBe(false);

    // (b) Warning written to stderr for the failing client.
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toMatch(/warning: failed to remove skills from Cursor/);

    // (c) Exit code set to 1.
    expect(process.exitCode).toBe(1);
  });
});

describe("reset --mcp --cursor (octen not present)", () => {
  it("reports octen not present without error", async () => {
    const home = makeTmp();

    // Config exists but without octen
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(
      join(home, ".cursor/mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "other" } } }),
      "utf8",
    );

    const prog = makeProgram(home, home);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await prog.parseAsync(["node", "octen", "reset", "--cursor", "--mcp"]);

    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toMatch(/octen not present in Cursor/);
    expect(process.exitCode).toBeUndefined();
  });
});
