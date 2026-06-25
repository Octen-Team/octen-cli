import { join } from "node:path";

export type McpFormat = "json-mcpServers" | "json-servers" | "toml" | "claude-code";

export interface McpClient {
  id: "claude-code" | "claude-desktop" | "cursor" | "windsurf" | "vscode" | "codex";
  label: string;
  format: McpFormat;
  supportsProject: boolean;
  pathFor(scope: "user" | "project", home: string, cwd: string): string;
}

export const MCP_CLIENTS: McpClient[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    format: "claude-code",
    supportsProject: false,
    pathFor(_scope, home, _cwd) {
      return join(home, ".claude.json");
    },
  },
  {
    id: "claude-desktop",
    label: "Claude Desktop",
    format: "json-mcpServers",
    supportsProject: false,
    pathFor(_scope, home, _cwd) {
      return join(home, "Library/Application Support/Claude/claude_desktop_config.json");
    },
  },
  {
    id: "cursor",
    label: "Cursor",
    format: "json-mcpServers",
    supportsProject: true,
    pathFor(scope, home, cwd) {
      return scope === "project" ? join(cwd, ".cursor/mcp.json") : join(home, ".cursor/mcp.json");
    },
  },
  {
    id: "windsurf",
    label: "Windsurf",
    format: "json-mcpServers",
    supportsProject: false,
    pathFor(_scope, home, _cwd) {
      return join(home, ".codeium/windsurf/mcp_config.json");
    },
  },
  {
    id: "vscode",
    label: "VS Code",
    format: "json-servers",
    supportsProject: true,
    // v1: project-scoped only; user scope also returns the project path
    pathFor(_scope, _home, cwd) {
      return join(cwd, ".vscode/mcp.json");
    },
  },
  {
    id: "codex",
    label: "Codex",
    format: "toml",
    supportsProject: false,
    pathFor(_scope, home, _cwd) {
      return join(home, ".codex/config.toml");
    },
  },
];
