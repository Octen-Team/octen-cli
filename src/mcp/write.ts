import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { parse as tomlParse, stringify as tomlStringify } from "smol-toml";
import type { McpFormat } from "./clients.js";

type JsonObj = Record<string, unknown>;

function readJsonFile(filePath: string): JsonObj {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, "utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw) as JsonObj;
}

function readTomlFile(filePath: string): JsonObj {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, "utf8").trim();
  if (!raw) return {};
  return tomlParse(raw) as JsonObj;
}

export function upsertMcpServer(filePath: string, format: McpFormat, entry: object): void {
  mkdirSync(dirname(filePath), { recursive: true });

  if (format === "json-mcpServers" || format === "claude-code") {
    const obj = readJsonFile(filePath);
    if (!obj.mcpServers || typeof obj.mcpServers !== "object") {
      obj.mcpServers = {} as JsonObj;
    }
    (obj.mcpServers as JsonObj)["octen"] = entry;
    writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
  } else if (format === "json-servers") {
    const obj = readJsonFile(filePath);
    if (!obj.servers || typeof obj.servers !== "object") {
      obj.servers = {} as JsonObj;
    }
    (obj.servers as JsonObj)["octen"] = entry;
    writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
  } else if (format === "toml") {
    const obj = readTomlFile(filePath);
    if (!obj.mcp_servers || typeof obj.mcp_servers !== "object") {
      obj.mcp_servers = {} as JsonObj;
    }
    (obj.mcp_servers as JsonObj)["octen"] = entry;
    writeFileSync(filePath, tomlStringify(obj), "utf8");
  }
}

export function removeMcpServer(filePath: string, format: McpFormat): boolean {
  if (!existsSync(filePath)) return false;

  if (format === "json-mcpServers" || format === "claude-code") {
    const obj = readJsonFile(filePath);
    const servers = obj.mcpServers as JsonObj | undefined;
    if (!servers || !("octen" in servers)) return false;
    delete servers["octen"];
    writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
    return true;
  } else if (format === "json-servers") {
    const obj = readJsonFile(filePath);
    const servers = obj.servers as JsonObj | undefined;
    if (!servers || !("octen" in servers)) return false;
    delete servers["octen"];
    writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
    return true;
  } else if (format === "toml") {
    const obj = readTomlFile(filePath);
    const servers = obj.mcp_servers as JsonObj | undefined;
    if (!servers || !("octen" in servers)) return false;
    delete servers["octen"];
    writeFileSync(filePath, tomlStringify(obj), "utf8");
    return true;
  }

  return false;
}
