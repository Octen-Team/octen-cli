import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as tomlParse } from "smol-toml";
import { setClientEnvKey } from "../../src/skills/setkey.js";

let tmpDirs: string[] = [];

function makeTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "octen-setkey-"));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs) {
    rmSync(d, { recursive: true, force: true });
  }
  tmpDirs = [];
});

describe("setClientEnvKey – claude-code", () => {
  it("merges OCTEN_API_KEY into settings.json while preserving existing keys", () => {
    const home = makeTmp();
    const path = join(home, ".claude/settings.json");
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(path, JSON.stringify({ theme: "dark" }), "utf8");

    const result = setClientEnvKey("claude-code", "abc123", "user", home, home);

    expect(result.written).toBe(true);
    expect(result.path).toBe(path);
    const obj = JSON.parse(readFileSync(path, "utf8"));
    expect(obj.env.OCTEN_API_KEY).toBe("abc123");
    expect(obj.theme).toBe("dark");
  });

  it("uses the project path under cwd when scope is project", () => {
    const home = makeTmp();
    const cwd = makeTmp();
    const result = setClientEnvKey("claude-code", "k", "project", home, cwd);
    expect(result.path).toBe(join(cwd, ".claude/settings.json"));
    expect(existsSync(result.path!)).toBe(true);
    expect(existsSync(join(home, ".claude/settings.json"))).toBe(false);
  });
});

describe("setClientEnvKey – codex", () => {
  it("merges OCTEN_API_KEY under shell_environment_policy.set, preserving other sections", () => {
    const home = makeTmp();
    const path = join(home, ".codex/config.toml");
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(path, '[model]\nname="x"\n', "utf8");

    const result = setClientEnvKey("codex", "abc123", "user", home, home);

    expect(result.written).toBe(true);
    expect(result.path).toBe(path);
    const obj = tomlParse(readFileSync(path, "utf8")) as any;
    expect(obj.model.name).toBe("x");
    expect(obj.shell_environment_policy.set.OCTEN_API_KEY).toBe("abc123");
  });
});

describe("setClientEnvKey – openclaw", () => {
  it("appends OCTEN_API_KEY to .env, preserving existing lines", () => {
    const home = makeTmp();
    const path = join(home, ".openclaw/.env");
    mkdirSync(join(home, ".openclaw"), { recursive: true });
    writeFileSync(path, "FOO=bar\n", "utf8");

    const result = setClientEnvKey("openclaw", "abc123", "user", home, home);

    expect(result.written).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toMatch(/^FOO=bar$/m);
    expect(text).toMatch(/^OCTEN_API_KEY=abc123$/m);
  });

  it("replaces an existing OCTEN_API_KEY line rather than duplicating it", () => {
    const home = makeTmp();
    const path = join(home, ".openclaw/.env");
    mkdirSync(join(home, ".openclaw"), { recursive: true });
    writeFileSync(path, "OCTEN_API_KEY=old\nFOO=bar\n", "utf8");

    setClientEnvKey("openclaw", "new", "user", home, home);

    const text = readFileSync(path, "utf8");
    expect(text).toMatch(/^OCTEN_API_KEY=new$/m);
    expect(text).not.toMatch(/OCTEN_API_KEY=old/);
    expect(text).toMatch(/^FOO=bar$/m);
  });
});

describe("setClientEnvKey – unsupported clients", () => {
  it("returns written:false + a shell-profile hint for cursor without editing rc files", () => {
    const home = makeTmp();
    const result = setClientEnvKey("cursor", "k", "user", home, home);
    expect(result.written).toBe(false);
    expect(result.hint).toMatch(/shell profile/);
  });

  it("returns written:false + hint for hermes", () => {
    const home = makeTmp();
    const result = setClientEnvKey("hermes", "k", "user", home, home);
    expect(result.written).toBe(false);
    expect(result.hint).toBeTruthy();
  });
});
