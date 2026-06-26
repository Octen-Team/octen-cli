import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { MCP_CLIENTS } from "../../src/mcp/clients.js";
import { mcpStatus } from "../../src/mcp/detect.js";

let tmpDir: string;

function makeTmp() {
  tmpDir = mkdtempSync(join(tmpdir(), "octen-detect-"));
  return tmpDir;
}

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = "";
  }
  vi.restoreAllMocks();
});

describe("mcpStatus", () => {
  it("returns 'absent' when the config file does not exist", () => {
    const home = makeTmp();
    const cursor = MCP_CLIENTS.find((c) => c.id === "cursor")!;
    expect(mcpStatus(cursor, "user", home, home)).toBe("absent");
  });

  it("returns 'configured' when octen is present", () => {
    const home = makeTmp();
    const cursor = MCP_CLIENTS.find((c) => c.id === "cursor")!;
    const filePath = cursor.pathFor("user", home, home);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify({ mcpServers: { octen: { command: "npx" } } }), "utf8");

    expect(mcpStatus(cursor, "user", home, home)).toBe("configured");
  });

  it("returns 'absent' AND warns to stderr with the file path on malformed JSON", () => {
    const home = makeTmp();
    const cursor = MCP_CLIENTS.find((c) => c.id === "cursor")!;
    const filePath = cursor.pathFor("user", home, home);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, "{ this is not valid json ", "utf8");

    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const status = mcpStatus(cursor, "user", home, home);

    expect(status).toBe("absent");
    expect(spy).toHaveBeenCalledTimes(1);
    const written = String(spy.mock.calls[0][0]);
    expect(written).toContain("warning: could not parse");
    expect(written).toContain(filePath);
  });

  it("returns 'absent' AND warns to stderr with the file path on malformed TOML", () => {
    const home = makeTmp();
    const codex = MCP_CLIENTS.find((c) => c.id === "codex")!;
    const filePath = codex.pathFor("user", home, home);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, "this = = not valid toml\n[unterminated\n", "utf8");

    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const status = mcpStatus(codex, "user", home, home);

    expect(status).toBe("absent");
    expect(spy).toHaveBeenCalledTimes(1);
    const written = String(spy.mock.calls[0][0]);
    expect(written).toContain(filePath);
  });
});
