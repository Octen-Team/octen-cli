import { execFileSync } from "node:child_process";
import { upsertMcpServer } from "./write.js";
import type { McpClient } from "./clients.js";

export interface InstallOpts {
  /** Override claude-CLI availability detection for testing */
  hasClaudeCli?: boolean;
}

export interface InstallResult {
  path: string;
  method: "claude-cli" | "file";
}

function claudeAvailable(override?: boolean): boolean {
  if (override !== undefined) return override;
  try {
    execFileSync("which", ["claude"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function installMcp(
  client: McpClient,
  scope: "user" | "project",
  entry: { command: string; args: string[]; env: Record<string, string> },
  home: string,
  cwd: string,
  opts: InstallOpts = {},
): InstallResult {
  if (client.id === "claude-code") {
    if (claudeAvailable(opts.hasClaudeCli)) {
      // Use claude CLI: build args safely, no string concatenation
      const apiKey = entry.env["OCTEN_API_KEY"] ?? "";
      execFileSync(
        "claude",
        [
          "mcp",
          "add",
          "--scope",
          scope,
          "octen",
          "-e",
          `OCTEN_API_KEY=${apiKey}`,
          "--",
          ...entry.args,
        ],
        { stdio: "inherit" },
      );
      return { path: client.pathFor(scope, home, cwd), method: "claude-cli" };
    } else {
      // Fall back to writing ~/.claude.json mcpServers directly
      const filePath = client.pathFor(scope, home, cwd);
      upsertMcpServer(filePath, "json-mcpServers", entry);
      return { path: filePath, method: "file" };
    }
  }

  // All other clients: write via file
  const filePath = client.pathFor(scope, home, cwd);
  upsertMcpServer(filePath, client.format, entry);
  return { path: filePath, method: "file" };
}
