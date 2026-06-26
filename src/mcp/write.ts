import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { parse as tomlParse, stringify as tomlStringify } from "smol-toml";
import type { McpFormat } from "./clients.js";
import { OctenValidationError } from "../api/errors.js";

type JsonObj = Record<string, unknown>;

function assertNever(x: never): never {
  throw new Error(`unhandled McpFormat: ${String(x)}`);
}

function readJsonFile(filePath: string): JsonObj {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, "utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as JsonObj;
  } catch (e) {
    throw new OctenValidationError(
      `Config file ${filePath} contains invalid JSON and cannot be edited safely. Fix or remove it, then retry. (${(e as Error).message})`,
    );
  }
}

function readTomlFile(filePath: string): JsonObj {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, "utf8").trim();
  if (!raw) return {};
  try {
    return tomlParse(raw) as JsonObj;
  } catch (e) {
    throw new OctenValidationError(
      `Config file ${filePath} contains invalid TOML and cannot be edited safely. Fix or remove it, then retry. (${(e as Error).message})`,
    );
  }
}

export function upsertMcpServer(filePath: string, format: McpFormat, entry: object): void {
  mkdirSync(dirname(filePath), { recursive: true });

  switch (format) {
    case "json-mcpServers":
    case "claude-code": {
      const obj = readJsonFile(filePath);
      if (!obj.mcpServers || typeof obj.mcpServers !== "object") {
        obj.mcpServers = {} as JsonObj;
      }
      (obj.mcpServers as JsonObj)["octen"] = entry;
      writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
      return;
    }
    case "json-servers": {
      const obj = readJsonFile(filePath);
      if (!obj.servers || typeof obj.servers !== "object") {
        obj.servers = {} as JsonObj;
      }
      (obj.servers as JsonObj)["octen"] = entry;
      writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
      return;
    }
    case "toml": {
      const obj = readTomlFile(filePath);
      if (!obj.mcp_servers || typeof obj.mcp_servers !== "object") {
        obj.mcp_servers = {} as JsonObj;
      }
      (obj.mcp_servers as JsonObj)["octen"] = entry;
      writeFileSync(filePath, tomlStringify(obj), "utf8");
      return;
    }
    default:
      assertNever(format);
  }
}

export function removeMcpServer(filePath: string, format: McpFormat): boolean {
  if (!existsSync(filePath)) return false;

  switch (format) {
    case "json-mcpServers":
    case "claude-code": {
      const obj = readJsonFile(filePath);
      const servers = obj.mcpServers as JsonObj | undefined;
      if (!servers || !("octen" in servers)) return false;
      delete servers["octen"];
      writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
      return true;
    }
    case "json-servers": {
      const obj = readJsonFile(filePath);
      const servers = obj.servers as JsonObj | undefined;
      if (!servers || !("octen" in servers)) return false;
      delete servers["octen"];
      writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
      return true;
    }
    case "toml": {
      const obj = readTomlFile(filePath);
      const servers = obj.mcp_servers as JsonObj | undefined;
      if (!servers || !("octen" in servers)) return false;
      delete servers["octen"];
      writeFileSync(filePath, tomlStringify(obj), "utf8");
      return true;
    }
    default:
      return assertNever(format);
  }
}
