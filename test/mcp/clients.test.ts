import { describe, it, expect } from "vitest";
import { MCP_CLIENTS } from "../../src/mcp/clients.js";

const HOME = "/tmp/h";
const CWD = "/tmp/c";

describe("MCP_CLIENTS registry", () => {
  it("has exactly 7 clients", () => {
    expect(MCP_CLIENTS).toHaveLength(7);
  });

  // Paths from Devin's MCP configuration docs (Devin CLI and Devin Local in Devin Desktop share them):
  // https://docs.devin.ai/cli/extensibility/mcp/configuration
  it("devin: user → ~/.config/devin/mcp_config.json, project → cwd/.devin/mcp_config.local.json", () => {
    const client = MCP_CLIENTS.find((c) => c.id === "devin")!;
    expect(client).toBeDefined();
    expect(client.format).toBe("json-mcpServers");
    expect(client.supportsProject).toBe(true);
    expect(client.pathFor("user", HOME, CWD)).toBe("/tmp/h/.config/devin/mcp_config.json");
    // The entry carries the API key, so project scope uses Devin's gitignored local file.
    expect(client.pathFor("project", HOME, CWD)).toBe("/tmp/c/.devin/mcp_config.local.json");
  });

  // Windows path from the same page: %APPDATA%\\devin\\mcp_config.json.
  it("devin: on Windows, user scope → %APPDATA%\\devin\\mcp_config.json", () => {
    const client = MCP_CLIENTS.find((c) => c.id === "devin")!;
    const env = { APPDATA: "C:\\Users\\u\\AppData\\Roaming" };
    expect(client.pathFor("user", "C:\\Users\\u", CWD, "win32", env)).toBe(
      "C:\\Users\\u\\AppData\\Roaming\\devin\\mcp_config.json",
    );
  });

  // Devin CLI 3000.14 writes user config under $XDG_CONFIG_HOME/devin when it is set (checked 2026-11-25).
  it("devin: user scope follows XDG_CONFIG_HOME, and ignores a relative one", () => {
    const client = MCP_CLIENTS.find((c) => c.id === "devin")!;
    expect(client.pathFor("user", HOME, CWD, "linux", { XDG_CONFIG_HOME: "/x/cfg" })).toBe("/x/cfg/devin/mcp_config.json");
    expect(client.pathFor("user", HOME, CWD, "darwin", { XDG_CONFIG_HOME: "rel" })).toBe("/tmp/h/.config/devin/mcp_config.json");
  });

  it("claude-code: user → ~/.claude.json", () => {
    const client = MCP_CLIENTS.find((c) => c.id === "claude-code")!;
    expect(client).toBeDefined();
    expect(client.format).toBe("claude-code");
    expect(client.supportsProject).toBe(false);
    expect(client.pathFor("user", HOME, CWD)).toBe("/tmp/h/.claude.json");
  });

  it("claude-desktop: user → Library/Application Support/Claude/…", () => {
    const client = MCP_CLIENTS.find((c) => c.id === "claude-desktop")!;
    expect(client).toBeDefined();
    expect(client.format).toBe("json-mcpServers");
    expect(client.supportsProject).toBe(false);
    expect(client.pathFor("user", HOME, CWD)).toBe(
      "/tmp/h/Library/Application Support/Claude/claude_desktop_config.json",
    );
  });

  it("cursor: user → ~/.cursor/mcp.json, project → cwd/.cursor/mcp.json", () => {
    const client = MCP_CLIENTS.find((c) => c.id === "cursor")!;
    expect(client).toBeDefined();
    expect(client.format).toBe("json-mcpServers");
    expect(client.supportsProject).toBe(true);
    expect(client.pathFor("user", HOME, CWD)).toBe("/tmp/h/.cursor/mcp.json");
    expect(client.pathFor("project", HOME, CWD)).toBe("/tmp/c/.cursor/mcp.json");
  });

  it("windsurf: user → ~/.codeium/windsurf/mcp_config.json", () => {
    const client = MCP_CLIENTS.find((c) => c.id === "windsurf")!;
    expect(client).toBeDefined();
    expect(client.format).toBe("json-mcpServers");
    expect(client.supportsProject).toBe(false);
    expect(client.pathFor("user", HOME, CWD)).toBe(
      "/tmp/h/.codeium/windsurf/mcp_config.json",
    );
  });

  it("vscode: project-scoped (both scopes → cwd/.vscode/mcp.json)", () => {
    const client = MCP_CLIENTS.find((c) => c.id === "vscode")!;
    expect(client).toBeDefined();
    expect(client.format).toBe("json-servers");
    expect(client.supportsProject).toBe(true);
    expect(client.pathFor("project", HOME, CWD)).toBe("/tmp/c/.vscode/mcp.json");
    expect(client.pathFor("user", HOME, CWD)).toBe("/tmp/c/.vscode/mcp.json");
  });

  it("codex: user → ~/.codex/config.toml, project → cwd/.codex/config.toml", () => {
    const client = MCP_CLIENTS.find((c) => c.id === "codex")!;
    expect(client).toBeDefined();
    expect(client.format).toBe("toml");
    // Codex reads a project-level .codex/config.toml in a trusted repository,
    // so project scope must not fall back to the user file.
    expect(client.supportsProject).toBe(true);
    expect(client.pathFor("user", HOME, CWD)).toBe("/tmp/h/.codex/config.toml");
    expect(client.pathFor("project", HOME, CWD)).toBe("/tmp/c/.codex/config.toml");
  });
});
