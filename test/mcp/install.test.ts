import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, platform } from "node:os";
import { parse as tomlParse } from "smol-toml";
import { MCP_CLIENTS } from "../../src/mcp/clients.js";
import { installMcp, removeMcp } from "../../src/mcp/install.js";
import { mcpStatus } from "../../src/mcp/detect.js";

// Mock node:child_process so we can spy on execFileSync without touching the real CLI
vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, execFileSync: vi.fn(original.execFileSync) };
});

// Import the mocked module so tests can inspect calls
import { execFileSync as mockExecFileSync } from "node:child_process";
const execFileSyncMock = mockExecFileSync as ReturnType<typeof vi.fn>;

const ENTRY = { command: "npx", args: ["-y", "octen-mcp"], env: { OCTEN_API_KEY: "testkey" } };

let tmpDir: string;

function makeTmp() {
  tmpDir = mkdtempSync(join(tmpdir(), "octen-install-"));
  return tmpDir;
}

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = "";
  }
  vi.clearAllMocks();
});

describe("installMcp – cursor (json-mcpServers)", () => {
  it("writes cursor mcp.json at user scope with octen entry", () => {
    const home = makeTmp();
    const cwd = home;
    const client = MCP_CLIENTS.find((c) => c.id === "cursor")!;

    const result = installMcp(client, "user", ENTRY, home, cwd, { hasClaudeCli: false });

    expect(result.method).toBe("file");
    expect(result.path).toBe(join(home, ".cursor/mcp.json"));

    const obj = JSON.parse(readFileSync(result.path, "utf8"));
    expect(obj.mcpServers.octen.command).toBe("npx");
    expect(obj.mcpServers.octen.args).toContain("octen-mcp");
    expect(obj.mcpServers.octen.env.OCTEN_API_KEY).toBe("testkey");
  });

  it("writes cursor mcp.json at project scope", () => {
    const home = makeTmp();
    const cwd = home;
    const client = MCP_CLIENTS.find((c) => c.id === "cursor")!;

    const result = installMcp(client, "project", ENTRY, home, cwd, { hasClaudeCli: false });

    expect(result.path).toBe(join(cwd, ".cursor/mcp.json"));
    const obj = JSON.parse(readFileSync(result.path, "utf8"));
    expect(obj.mcpServers.octen).toBeDefined();
  });
});

describe("installMcp – codex (toml)", () => {
  it("writes codex TOML config at user scope with octen entry", () => {
    const home = makeTmp();
    const cwd = home;
    const client = MCP_CLIENTS.find((c) => c.id === "codex")!;

    const result = installMcp(client, "user", ENTRY, home, cwd, { hasClaudeCli: false });

    expect(result.method).toBe("file");
    expect(result.path).toBe(join(home, ".codex/config.toml"));

    const parsed = tomlParse(readFileSync(result.path, "utf8")) as Record<string, any>;
    expect(parsed.mcp_servers.octen.command).toBe("npx");
    expect(parsed.mcp_servers.octen.env.OCTEN_API_KEY).toBe("testkey");
  });
});

describe("installMcp – claude-code (file fallback)", () => {
  it("writes ~/.claude.json mcpServers when claude CLI not available", () => {
    const home = makeTmp();
    const cwd = home;
    const client = MCP_CLIENTS.find((c) => c.id === "claude-code")!;

    const result = installMcp(client, "user", ENTRY, home, cwd, { hasClaudeCli: false });

    expect(result.method).toBe("file");
    expect(result.path).toBe(join(home, ".claude.json"));

    const obj = JSON.parse(readFileSync(result.path, "utf8"));
    expect(obj.mcpServers.octen.command).toBe("npx");
  });
});

describe("installMcp – claude-code (claude-cli path)", () => {
  beforeEach(() => {
    // Prevent real execFileSync from running — return void (success)
    execFileSyncMock.mockReturnValue(undefined as any);
  });

  // 占位符不是秘密，仍走 claude CLI。这条继续钉住"参数以数组元素传递、不做字符串
  // 拼接"，因为这条路径依然存在。
  it("invokes execFileSync with exact args array (injection-safe) for the placeholder", () => {
    const home = makeTmp();
    const cwd = home;
    const client = MCP_CLIENTS.find((c) => c.id === "claude-code")!;
    const entry = {
      command: "npx",
      args: ["-y", "octen-mcp"],
      env: { OCTEN_API_KEY: "${OCTEN_API_KEY}" },
    };

    const result = installMcp(client, "user", entry, home, cwd, { hasClaudeCli: true });

    expect(result.method).toBe("claude-cli");

    const claudeCall = execFileSyncMock.mock.calls.find((call) => call[0] === "claude");
    expect(claudeCall).toBeDefined();

    const [cmd, args] = claudeCall!;
    expect(cmd).toBe("claude");
    expect(args).toEqual([
      "mcp",
      "add",
      "--scope",
      "user",
      "octen",
      "-e",
      "OCTEN_API_KEY=${OCTEN_API_KEY}",
      "--",
      "npx",
      "-y",
      "octen-mcp",
    ]);
  });

  // 一个真实的 key 绝不能进另一个进程的 argv：`ps -ww` 与 /proc/<pid>/cmdline 在子
  // 进程存活期间对同机任意用户可见。改动前这条路径是可达的——凭证解析学会读
  // ~/.octen/credentials.json 之后，一个只存在于 0600 文件里的 key 会流到这里。
  // 所以字面 key 一律改走文件路径（本函数在没有 claude CLI 时本来就用它）。
  it("never puts a literal key in a child process argv — it takes the file path instead", () => {
    const home = makeTmp();
    const cwd = home;
    const client = MCP_CLIENTS.find((c) => c.id === "claude-code")!;
    const entry = {
      command: "npx",
      args: ["-y", "octen-mcp"],
      env: { OCTEN_API_KEY: "octen-literal-secret" },
    };

    const result = installMcp(client, "user", entry, home, cwd, { hasClaudeCli: true });

    expect(result.method).toBe("file");
    const claudeCall = execFileSyncMock.mock.calls.find((call) => call[0] === "claude");
    expect(claudeCall).toBeUndefined();
    const everySpawnedArg = JSON.stringify(execFileSyncMock.mock.calls);
    expect(everySpawnedArg).not.toContain("octen-literal-secret");

    // 条目仍然被正确写入，且文件被限制成 0600（见 util/secretFile.ts）。
    const written = readFileSync(join(home, ".claude.json"), "utf8");
    expect(written).toContain("octen-literal-secret");
    if (platform() !== "win32") {
      expect(statSync(join(home, ".claude.json")).mode & 0o777).toBe(0o600);
    }
  });

});

describe("removeMcp – cursor (file path)", () => {
  it("removes octen from cursor mcp.json while leaving other entries", () => {
    const home = makeTmp();
    const client = MCP_CLIENTS.find((c) => c.id === "cursor")!;
    const configPath = join(home, ".cursor/mcp.json");

    // Pre-seed cursor config with octen + another server
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({ mcpServers: { octen: { command: "npx" }, other: { command: "other" } } }),
      "utf8",
    );

    const result = removeMcp(client, "user", home, home, { hasClaudeCli: false });

    expect(result.method).toBe("file");
    expect(result.removed).toBe(true);
    expect(result.path).toBe(configPath);

    const obj = JSON.parse(readFileSync(configPath, "utf8"));
    // octen is gone
    expect(obj.mcpServers.octen).toBeUndefined();
    // other server survives
    expect(obj.mcpServers.other).toBeDefined();
  });

  it("returns removed=false when config file does not exist", () => {
    const home = makeTmp();
    const client = MCP_CLIENTS.find((c) => c.id === "cursor")!;

    const result = removeMcp(client, "user", home, home, { hasClaudeCli: false });

    expect(result.method).toBe("file");
    expect(result.removed).toBe(false);
  });

  it("returns removed=false when octen is not present in existing config", () => {
    const home = makeTmp();
    const client = MCP_CLIENTS.find((c) => c.id === "cursor")!;

    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(
      join(home, ".cursor/mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "other" } } }),
      "utf8",
    );

    const result = removeMcp(client, "user", home, home, { hasClaudeCli: false });

    expect(result.removed).toBe(false);
  });
});

describe("removeMcp – claude-code (claude-cli path)", () => {
  beforeEach(() => {
    execFileSyncMock.mockReturnValue(undefined as any);
  });

  it("calls execFileSync with claude + ['mcp','remove','octen'] when hasClaudeCli=true", () => {
    const home = makeTmp();
    const client = MCP_CLIENTS.find((c) => c.id === "claude-code")!;

    const result = removeMcp(client, "user", home, home, { hasClaudeCli: true });

    expect(result.method).toBe("claude-cli");
    expect(result.removed).toBe(true);

    const claudeCall = execFileSyncMock.mock.calls.find((call) => call[0] === "claude");
    expect(claudeCall).toBeDefined();

    const [cmd, args] = claudeCall!;
    expect(cmd).toBe("claude");
    expect(args).toEqual(["mcp", "remove", "--scope", "user", "octen"]);
  });
});

describe("mcpStatus", () => {
  it("returns 'absent' when config file does not exist", () => {
    const home = makeTmp();
    const client = MCP_CLIENTS.find((c) => c.id === "cursor")!;
    expect(mcpStatus(client, "user", home, home)).toBe("absent");
  });

  it("returns 'configured' after installing cursor", () => {
    const home = makeTmp();
    const client = MCP_CLIENTS.find((c) => c.id === "cursor")!;
    installMcp(client, "user", ENTRY, home, home, { hasClaudeCli: false });
    expect(mcpStatus(client, "user", home, home)).toBe("configured");
  });

  it("returns 'configured' after installing codex TOML", () => {
    const home = makeTmp();
    const client = MCP_CLIENTS.find((c) => c.id === "codex")!;
    installMcp(client, "user", ENTRY, home, home, { hasClaudeCli: false });
    expect(mcpStatus(client, "user", home, home)).toBe("configured");
  });

  it("returns 'absent' after file exists but octen not present", () => {
    const home = makeTmp();
    const client = MCP_CLIENTS.find((c) => c.id === "cursor")!;
    // write a cursor config with only another server
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(
      join(home, ".cursor/mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "other" } } }),
      "utf8",
    );
    expect(mcpStatus(client, "user", home, home)).toBe("absent");
  });
});
