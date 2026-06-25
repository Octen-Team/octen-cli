import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as tomlParse } from "smol-toml";
import { MCP_CLIENTS } from "../../src/mcp/clients.js";
import { installMcp } from "../../src/mcp/install.js";
import { mcpStatus } from "../../src/mcp/detect.js";

const ENTRY = { command: "npx", args: ["-y", "octen-mcp"], env: { OCTEN_API_KEY: "testkey" } };

let tmpDir: string;

function makeTmp() {
  tmpDir = mkdtempSync(join(tmpdir(), "octen-install-"));
  return tmpDir;
}

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = "";
  }
});

describe("installMcp – cursor (json-mcpServers)", () => {
  it("writes cursor mcp.json at user scope with octen entry", () => {
    const home = makeTmp();
    const cwd = home;
    const client = MCP_CLIENTS.find((c) => c.id === "cursor")!;

    const result = installMcp(client, "user", ENTRY, home, cwd, { hasClaudeCli: false });

    expect(result.method).toBe("file");
    expect(result.path).toBe(join(home, ".cursor/mcp.json"));

    const obj = JSON.parse(readFileSync(result.path, "utf8"));
    expect(obj.mcpServers.octen.command).toBe("npx");
    expect(obj.mcpServers.octen.args).toContain("octen-mcp");
    expect(obj.mcpServers.octen.env.OCTEN_API_KEY).toBe("testkey");
  });

  it("writes cursor mcp.json at project scope", () => {
    const home = makeTmp();
    const cwd = home;
    const client = MCP_CLIENTS.find((c) => c.id === "cursor")!;

    const result = installMcp(client, "project", ENTRY, home, cwd, { hasClaudeCli: false });

    expect(result.path).toBe(join(cwd, ".cursor/mcp.json"));
    const obj = JSON.parse(readFileSync(result.path, "utf8"));
    expect(obj.mcpServers.octen).toBeDefined();
  });
});

describe("installMcp – codex (toml)", () => {
  it("writes codex TOML config at user scope with octen entry", () => {
    const home = makeTmp();
    const cwd = home;
    const client = MCP_CLIENTS.find((c) => c.id === "codex")!;

    const result = installMcp(client, "user", ENTRY, home, cwd, { hasClaudeCli: false });

    expect(result.method).toBe("file");
    expect(result.path).toBe(join(home, ".codex/config.toml"));

    const parsed = tomlParse(readFileSync(result.path, "utf8")) as Record<string, any>;
    expect(parsed.mcp_servers.octen.command).toBe("npx");
    expect(parsed.mcp_servers.octen.env.OCTEN_API_KEY).toBe("testkey");
  });
});

describe("installMcp – claude-code (file fallback)", () => {
  it("writes ~/.claude.json mcpServers when claude CLI not available", () => {
    const home = makeTmp();
    const cwd = home;
    const client = MCP_CLIENTS.find((c) => c.id === "claude-code")!;

    const result = installMcp(client, "user", ENTRY, home, cwd, { hasClaudeCli: false });

    expect(result.method).toBe("file");
    expect(result.path).toBe(join(home, ".claude.json"));

    const obj = JSON.parse(readFileSync(result.path, "utf8"));
    expect(obj.mcpServers.octen.command).toBe("npx");
  });
});

describe("mcpStatus", () => {
  it("returns 'absent' when config file does not exist", () => {
    const home = makeTmp();
    const client = MCP_CLIENTS.find((c) => c.id === "cursor")!;
    expect(mcpStatus(client, "user", home, home)).toBe("absent");
  });

  it("returns 'configured' after installing cursor", () => {
    const home = makeTmp();
    const client = MCP_CLIENTS.find((c) => c.id === "cursor")!;
    installMcp(client, "user", ENTRY, home, home, { hasClaudeCli: false });
    expect(mcpStatus(client, "user", home, home)).toBe("configured");
  });

  it("returns 'configured' after installing codex TOML", () => {
    const home = makeTmp();
    const client = MCP_CLIENTS.find((c) => c.id === "codex")!;
    installMcp(client, "user", ENTRY, home, home, { hasClaudeCli: false });
    expect(mcpStatus(client, "user", home, home)).toBe("configured");
  });

  it("returns 'absent' after file exists but octen not present", () => {
    const home = makeTmp();
    const client = MCP_CLIENTS.find((c) => c.id === "cursor")!;
    // write a cursor config with only another server
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(
      join(home, ".cursor/mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "other" } } }),
      "utf8",
    );
    expect(mcpStatus(client, "user", home, home)).toBe("absent");
  });
});
