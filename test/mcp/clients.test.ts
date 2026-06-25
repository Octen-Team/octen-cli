import { describe, it, expect } from "vitest";
import { MCP_CLIENTS } from "../../src/mcp/clients.js";

const HOME = "/tmp/h";
const CWD = "/tmp/c";

describe("MCP_CLIENTS registry", () => {
  it("has exactly 6 clients", () => {
    expect(MCP_CLIENTS).toHaveLength(6);
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

  it("codex: user → ~/.codex/config.toml", () => {
    const client = MCP_CLIENTS.find((c) => c.id === "codex")!;
    expect(client).toBeDefined();
    expect(client.format).toBe("toml");
    expect(client.supportsProject).toBe(false);
    expect(client.pathFor("user", HOME, CWD)).toBe("/tmp/h/.codex/config.toml");
  });
});
