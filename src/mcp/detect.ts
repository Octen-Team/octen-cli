import { existsSync, readFileSync } from "node:fs";
import { parse as tomlParse } from "smol-toml";
import type { McpClient } from "./clients.js";

export function mcpStatus(
  client: McpClient,
  scope: "user" | "project",
  home: string,
  cwd: string,
): "configured" | "absent" {
  const filePath = client.pathFor(scope, home, cwd);

  if (!existsSync(filePath)) return "absent";

  const raw = readFileSync(filePath, "utf8").trim();
  if (!raw) return "absent";

  try {
    if (client.format === "toml") {
      const obj = tomlParse(raw) as Record<string, any>;
      const servers = obj.mcp_servers;
      if (servers && typeof servers === "object" && "octen" in servers) {
        return "configured";
      }
      return "absent";
    } else {
      // JSON formats
      const obj = JSON.parse(raw) as Record<string, any>;
      // claude-code, json-mcpServers → check mcpServers
      // json-servers → check servers
      const container =
        client.format === "json-servers" ? obj.servers : obj.mcpServers;
      if (container && typeof container === "object" && "octen" in container) {
        return "configured";
      }
      return "absent";
    }
  } catch {
    return "absent";
  }
}
