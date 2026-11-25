import { isAbsolute, join, win32 } from "node:path";

export type McpFormat = "json-mcpServers" | "json-servers" | "toml" | "claude-code";

/** Octen's hosted MCP server, for clients configured with it instead of a local npx server. */
export const HOSTED_MCP_URL = "https://mcp.octen.ai/mcp";

export interface McpClient {
  id: "claude-code" | "claude-desktop" | "cursor" | "windsurf" | "vscode" | "codex" | "devin";
  label: string;
  format: McpFormat;
  supportsProject: boolean;
  /** Configure the hosted server (url + x-api-key header) rather than `npx octen-mcp`. */
  hosted?: boolean;
  pathFor(
    scope: "user" | "project",
    home: string,
    cwd: string,
    platform?: NodeJS.Platform,
    env?: NodeJS.ProcessEnv,
  ): string;
}

/** Devin's user config directory: %APPDATA%\devin on Windows, else $XDG_CONFIG_HOME/devin or ~/.config/devin. */
export function devinConfigDir(
  home: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === "win32") return win32.join(env.APPDATA ?? win32.join(home, "AppData", "Roaming"), "devin");
  const xdg = env.XDG_CONFIG_HOME;
  return xdg && isAbsolute(xdg) ? join(xdg, "devin") : join(home, ".config/devin");
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
    // Codex reads a project-level .codex/config.toml (MCP servers included) in a
    // repository it has been told to trust, so project scope has a real target.
    supportsProject: true,
    pathFor(scope, home, cwd) {
      return scope === "project"
        ? join(cwd, ".codex/config.toml")
        : join(home, ".codex/config.toml");
    },
  },
  {
    id: "devin",
    label: "Devin",
    format: "json-mcpServers",
    // Devin CLI and Devin Local (in Devin Desktop) read the same files:
    // https://docs.devin.ai/cli/extensibility/mcp/configuration
    // Project scope uses the personal local file; configure-mcp puts only an env reference there.
    supportsProject: true,
    hosted: true,
    pathFor(scope, home, cwd, platform, env) {
      if (scope === "project") return join(cwd, ".devin/mcp_config.local.json");
      const dir = devinConfigDir(home, platform, env);
      return (platform ?? process.platform) === "win32" ? win32.join(dir, "mcp_config.json") : join(dir, "mcp_config.json");
    },
  },
];
