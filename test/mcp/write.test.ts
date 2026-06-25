import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as tomlParse, stringify as tomlStringify } from "smol-toml";
import { upsertMcpServer, removeMcpServer } from "../../src/mcp/write.js";

const ENTRY = { command: "npx", args: ["-y", "octen-mcp"], env: { OCTEN_API_KEY: "k" } };

let tmpDir: string;

function makeTmp() {
  tmpDir = mkdtempSync(join(tmpdir(), "octen-write-"));
  return tmpDir;
}

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = "";
  }
});

describe("upsertMcpServer – json-mcpServers", () => {
  it("creates a missing file with octen entry", () => {
    const dir = makeTmp();
    const filePath = join(dir, "mcp.json");

    upsertMcpServer(filePath, "json-mcpServers", ENTRY);

    const obj = JSON.parse(readFileSync(filePath, "utf8"));
    expect(obj.mcpServers.octen.command).toBe("npx");
    expect(obj.mcpServers.octen.args).toContain("octen-mcp");
  });

  it("preserves existing servers when adding octen", () => {
    const dir = makeTmp();
    const filePath = join(dir, "mcp.json");
    writeFileSync(filePath, JSON.stringify({ mcpServers: { other: { command: "other" } } }), "utf8");

    upsertMcpServer(filePath, "json-mcpServers", ENTRY);

    const obj = JSON.parse(readFileSync(filePath, "utf8"));
    expect(obj.mcpServers.other.command).toBe("other");
    expect(obj.mcpServers.octen.command).toBe("npx");
  });

  it("is idempotent: upserting twice results in one octen entry", () => {
    const dir = makeTmp();
    const filePath = join(dir, "mcp.json");

    upsertMcpServer(filePath, "json-mcpServers", ENTRY);
    upsertMcpServer(filePath, "json-mcpServers", ENTRY);

    const obj = JSON.parse(readFileSync(filePath, "utf8"));
    expect(Object.keys(obj.mcpServers)).toHaveLength(1);
    expect(obj.mcpServers.octen).toBeDefined();
  });

  it("creates parent directories if missing", () => {
    const dir = makeTmp();
    const filePath = join(dir, "nested", "deep", "mcp.json");

    upsertMcpServer(filePath, "json-mcpServers", ENTRY);

    const obj = JSON.parse(readFileSync(filePath, "utf8"));
    expect(obj.mcpServers.octen).toBeDefined();
  });
});

describe("upsertMcpServer – json-servers (vscode)", () => {
  it("writes entry under 'servers' key", () => {
    const dir = makeTmp();
    const filePath = join(dir, "mcp.json");

    upsertMcpServer(filePath, "json-servers", ENTRY);

    const obj = JSON.parse(readFileSync(filePath, "utf8"));
    expect(obj.servers.octen.command).toBe("npx");
  });

  it("preserves existing servers under 'servers'", () => {
    const dir = makeTmp();
    const filePath = join(dir, "mcp.json");
    writeFileSync(filePath, JSON.stringify({ servers: { other: { command: "other" } } }), "utf8");

    upsertMcpServer(filePath, "json-servers", ENTRY);

    const obj = JSON.parse(readFileSync(filePath, "utf8"));
    expect(obj.servers.other.command).toBe("other");
    expect(obj.servers.octen.command).toBe("npx");
  });
});

describe("upsertMcpServer – toml (codex)", () => {
  it("creates a missing TOML file with octen entry", () => {
    const dir = makeTmp();
    const filePath = join(dir, "config.toml");

    upsertMcpServer(filePath, "toml", ENTRY);

    const parsed = tomlParse(readFileSync(filePath, "utf8")) as Record<string, any>;
    expect(parsed.mcp_servers.octen.command).toBe("npx");
  });

  it("preserves existing [mcp_servers.other] and adds octen", () => {
    const dir = makeTmp();
    const filePath = join(dir, "config.toml");
    writeFileSync(filePath, "[mcp_servers.other]\ncommand = \"other\"\n", "utf8");

    upsertMcpServer(filePath, "toml", ENTRY);

    const parsed = tomlParse(readFileSync(filePath, "utf8")) as Record<string, any>;
    expect(parsed.mcp_servers.other.command).toBe("other");
    expect(parsed.mcp_servers.octen.command).toBe("npx");
    expect(parsed.mcp_servers.octen.args).toContain("octen-mcp");
  });

  it("TOML idempotency: upsert twice → one octen entry", () => {
    const dir = makeTmp();
    const filePath = join(dir, "config.toml");

    upsertMcpServer(filePath, "toml", ENTRY);
    upsertMcpServer(filePath, "toml", ENTRY);

    const parsed = tomlParse(readFileSync(filePath, "utf8")) as Record<string, any>;
    expect(Object.keys(parsed.mcp_servers)).toHaveLength(1);
  });
});

describe("removeMcpServer", () => {
  it("returns false when file does not exist", () => {
    const dir = makeTmp();
    const result = removeMcpServer(join(dir, "no-such.json"), "json-mcpServers");
    expect(result).toBe(false);
  });

  it("removes octen and returns true, leaves other servers intact (json-mcpServers)", () => {
    const dir = makeTmp();
    const filePath = join(dir, "mcp.json");
    writeFileSync(
      filePath,
      JSON.stringify({ mcpServers: { other: { command: "other" }, octen: ENTRY } }),
      "utf8",
    );

    const result = removeMcpServer(filePath, "json-mcpServers");

    expect(result).toBe(true);
    const obj = JSON.parse(readFileSync(filePath, "utf8"));
    expect(obj.mcpServers.other).toBeDefined();
    expect(obj.mcpServers.octen).toBeUndefined();
  });

  it("returns false when octen is absent in json-mcpServers", () => {
    const dir = makeTmp();
    const filePath = join(dir, "mcp.json");
    writeFileSync(filePath, JSON.stringify({ mcpServers: { other: { command: "other" } } }), "utf8");

    const result = removeMcpServer(filePath, "json-mcpServers");
    expect(result).toBe(false);
  });

  it("removes octen from TOML and returns true", () => {
    const dir = makeTmp();
    const filePath = join(dir, "config.toml");
    upsertMcpServer(filePath, "toml", ENTRY);
    // add another server too
    const parsed = tomlParse(readFileSync(filePath, "utf8")) as Record<string, any>;
    parsed.mcp_servers.other = { command: "other" };
    writeFileSync(filePath, tomlStringify(parsed), "utf8");

    const result = removeMcpServer(filePath, "toml");

    expect(result).toBe(true);
    const after = tomlParse(readFileSync(filePath, "utf8")) as Record<string, any>;
    expect(after.mcp_servers.octen).toBeUndefined();
    expect(after.mcp_servers.other).toBeDefined();
  });
});
