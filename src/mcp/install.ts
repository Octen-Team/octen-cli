import { execFileSync } from "node:child_process";
import { upsertMcpServer, removeMcpServer } from "./write.js";
import type { McpClient } from "./clients.js";

export interface InstallOpts {
  /** Override claude-CLI availability detection for testing */
  hasClaudeCli?: boolean;
}

export interface InstallResult {
  path: string;
  method: "claude-cli" | "file";
}

export interface RemoveResult {
  path: string;
  removed: boolean;
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
    const apiKey = entry.env["OCTEN_API_KEY"] ?? "";
    // A real key must never reach another process's argv: `ps -ww` and
    // /proc/<pid>/cmdline expose it to every local user for the child's
    // lifetime. That used to be harmless here because the only values that
    // could arrive were ones the user had already put in argv (`--api-key`) or
    // the environment (`OCTEN_API_KEY`); since credential resolution learned to
    // read ~/.octen/credentials.json, a key that exists nowhere but a 0600 file
    // can land here, and shelling out would be the one thing that leaks it.
    //
    // So: when the value is a literal secret, take the file path — the same
    // path this function already uses when the `claude` CLI is absent, writing
    // the same `mcpServers` entry to the same file. The CLI is still used for
    // the `${OCTEN_API_KEY}` placeholder, which is not a secret.
    const carriesLiteralSecret = apiKey !== "" && !apiKey.startsWith("${");
    if (claudeAvailable(opts.hasClaudeCli) && !carriesLiteralSecret) {
      // Use claude CLI: build args safely, no string concatenation
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
          entry.command,
          ...entry.args,
        ],
        { stdio: "inherit" },
      );
      return { path: client.pathFor(scope, home, cwd), method: "claude-cli" };
    } else {
      // Fall back to writing ~/.claude.json mcpServers directly
      const filePath = client.pathFor(scope, home, cwd);
      upsertMcpServer(filePath, client.format, entry);
      return { path: filePath, method: "file" };
    }
  }

  // All other clients: write via file
  const filePath = client.pathFor(scope, home, cwd);
  upsertMcpServer(filePath, client.format, entry);
  return { path: filePath, method: "file" };
}

export function removeMcp(
  client: McpClient,
  scope: "user" | "project",
  home: string,
  cwd: string,
  opts: InstallOpts = {},
): RemoveResult {
  if (client.id === "claude-code") {
    if (claudeAvailable(opts.hasClaudeCli)) {
      execFileSync("claude", ["mcp", "remove", "--scope", scope, "octen"], { stdio: "inherit" });
      return { path: client.pathFor(scope, home, cwd), removed: true, method: "claude-cli" };
    }
  }

  // All other clients (and claude-code without CLI): write via file
  const filePath = client.pathFor(scope, home, cwd);
  const removed = removeMcpServer(filePath, client.format);
  return { path: filePath, removed, method: "file" };
}
