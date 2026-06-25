import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { SKILL_CLIENTS } from "../../src/skills/clients.js";

const HOME = "/fake/home";
const CWD = "/fake/cwd";

describe("SKILL_CLIENTS path resolution", () => {
  it("claude-code user scope → ~/.claude/skills", () => {
    const c = SKILL_CLIENTS.find((c) => c.id === "claude-code")!;
    expect(c.dirFor("user", HOME, CWD)).toBe(join(HOME, ".claude/skills"));
  });

  it("claude-code project scope → <cwd>/.claude/skills", () => {
    const c = SKILL_CLIENTS.find((c) => c.id === "claude-code")!;
    expect(c.dirFor("project", HOME, CWD)).toBe(join(CWD, ".claude/skills"));
  });

  it("cursor user scope → ~/.cursor/skills", () => {
    const c = SKILL_CLIENTS.find((c) => c.id === "cursor")!;
    expect(c.dirFor("user", HOME, CWD)).toBe(join(HOME, ".cursor/skills"));
  });

  it("cursor project scope → <cwd>/.cursor/skills", () => {
    const c = SKILL_CLIENTS.find((c) => c.id === "cursor")!;
    expect(c.dirFor("project", HOME, CWD)).toBe(join(CWD, ".cursor/skills"));
  });

  it("codex → ~/.codex/skills (project scope same as user)", () => {
    const c = SKILL_CLIENTS.find((c) => c.id === "codex")!;
    expect(c.dirFor("user", HOME, CWD)).toBe(join(HOME, ".codex/skills"));
    expect(c.dirFor("project", HOME, CWD)).toBe(join(HOME, ".codex/skills"));
    expect(c.supportsProject).toBe(false);
  });

  it("openclaw → ~/.openclaw/skills", () => {
    const c = SKILL_CLIENTS.find((c) => c.id === "openclaw")!;
    expect(c.dirFor("user", HOME, CWD)).toBe(join(HOME, ".openclaw/skills"));
    expect(c.supportsProject).toBe(false);
  });

  it("hermes → ~/.hermes/skills", () => {
    const c = SKILL_CLIENTS.find((c) => c.id === "hermes")!;
    expect(c.dirFor("user", HOME, CWD)).toBe(join(HOME, ".hermes/skills"));
    expect(c.supportsProject).toBe(false);
  });

  it("all 5 clients present", () => {
    const ids = SKILL_CLIENTS.map((c) => c.id);
    expect(ids).toContain("claude-code");
    expect(ids).toContain("cursor");
    expect(ids).toContain("codex");
    expect(ids).toContain("openclaw");
    expect(ids).toContain("hermes");
    expect(SKILL_CLIENTS).toHaveLength(5);
  });
});
