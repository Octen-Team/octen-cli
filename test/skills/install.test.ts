import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installSkills, skillStatus } from "../../src/skills/install.js";

let tmpDirs: string[] = [];

function makeTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "octen-install-"));
  tmpDirs.push(d);
  return d;
}

function seedSrcDir(dir: string, skills: string[]): void {
  for (const name of skills) {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, "SKILL.md"), `# ${name}\n`, "utf8");
  }
}

afterEach(() => {
  for (const d of tmpDirs) {
    rmSync(d, { recursive: true, force: true });
  }
  tmpDirs = [];
});

describe("installSkills", () => {
  it("copies octen-* skills and writes .octen-version", () => {
    const src = makeTmp();
    const target = join(makeTmp(), "skills");
    seedSrcDir(src, ["octen-search", "octen-web-search"]);

    const installed = installSkills(src, target, "main");

    expect(installed.sort()).toEqual(["octen-search", "octen-web-search"]);
    expect(existsSync(join(target, "octen-search", "SKILL.md"))).toBe(true);
    expect(existsSync(join(target, "octen-web-search", "SKILL.md"))).toBe(true);
    expect(readFileSync(join(target, "octen-search", ".octen-version"), "utf8")).toBe("main");
    expect(readFileSync(join(target, "octen-web-search", ".octen-version"), "utf8")).toBe("main");
  });

  it("non-octen skill dirs in target survive (are not touched)", () => {
    const src = makeTmp();
    const target = makeTmp();
    // Pre-seed a non-octen dir in target
    mkdirSync(join(target, "my-custom-skill"), { recursive: true });
    writeFileSync(join(target, "my-custom-skill", "SKILL.md"), "# custom\n", "utf8");
    // Seed src with octen- skills only
    seedSrcDir(src, ["octen-search"]);

    installSkills(src, target, "main");

    // custom skill should still be there
    expect(existsSync(join(target, "my-custom-skill", "SKILL.md"))).toBe(true);
    // octen skill should be installed
    expect(existsSync(join(target, "octen-search", "SKILL.md"))).toBe(true);
  });

  it("only installs skills listed in `only` filter", () => {
    const src = makeTmp();
    const target = join(makeTmp(), "skills");
    seedSrcDir(src, ["octen-search", "octen-web-search"]);

    const installed = installSkills(src, target, "main", ["octen-search"]);

    expect(installed).toEqual(["octen-search"]);
    expect(existsSync(join(target, "octen-search", "SKILL.md"))).toBe(true);
    expect(existsSync(join(target, "octen-web-search"))).toBe(false);
  });

  it("creates targetSkillsDir if it does not exist", () => {
    const src = makeTmp();
    const target = join(makeTmp(), "deep", "nested", "skills");
    seedSrcDir(src, ["octen-search"]);

    installSkills(src, target, "v1.2.3");

    expect(existsSync(join(target, "octen-search", "SKILL.md"))).toBe(true);
    expect(readFileSync(join(target, "octen-search", ".octen-version"), "utf8")).toBe("v1.2.3");
  });

  it("clean update: removes stale files from existing octen-* skill dir", () => {
    const src = makeTmp();
    const target = makeTmp();
    // Pre-create an existing octen-search dir in target with a stale file
    mkdirSync(join(target, "octen-search"), { recursive: true });
    writeFileSync(join(target, "octen-search", "STALE.md"), "stale content\n", "utf8");
    // Src has octen-search/SKILL.md but no STALE.md
    seedSrcDir(src, ["octen-search"]);

    installSkills(src, target, "main");

    // STALE.md must be gone — clean update removes the old dir first
    expect(existsSync(join(target, "octen-search", "STALE.md"))).toBe(false);
    // SKILL.md from src must be present
    expect(existsSync(join(target, "octen-search", "SKILL.md"))).toBe(true);
  });

  it("does not copy non-octen dirs from src", () => {
    const src = makeTmp();
    const target = join(makeTmp(), "skills");
    // Put a non-octen dir in src
    mkdirSync(join(src, "some-other-skill"), { recursive: true });
    writeFileSync(join(src, "some-other-skill", "SKILL.md"), "# other\n", "utf8");
    seedSrcDir(src, ["octen-search"]);

    installSkills(src, target, "main");

    expect(existsSync(join(target, "some-other-skill"))).toBe(false);
    expect(existsSync(join(target, "octen-search"))).toBe(true);
  });
});

describe("skillStatus", () => {
  it("returns empty object when target dir does not exist", () => {
    const target = join(makeTmp(), "nonexistent");
    expect(skillStatus(target)).toEqual({});
  });

  it("reports installed skill names and their versions", () => {
    const src = makeTmp();
    const target = makeTmp();
    seedSrcDir(src, ["octen-search", "octen-web-search"]);

    installSkills(src, target, "main");

    const status = skillStatus(target);
    expect(status["octen-search"]).toBe("main");
    expect(status["octen-web-search"]).toBe("main");
  });

  it("reports null version when .octen-version file is absent", () => {
    const target = makeTmp();
    // Create an octen- dir without a version file
    mkdirSync(join(target, "octen-search"), { recursive: true });
    writeFileSync(join(target, "octen-search", "SKILL.md"), "# x\n", "utf8");

    const status = skillStatus(target);
    expect(status["octen-search"]).toBeNull();
  });

  it("does not include non-octen dirs in status", () => {
    const target = makeTmp();
    mkdirSync(join(target, "my-skill"), { recursive: true });
    mkdirSync(join(target, "octen-search"), { recursive: true });
    writeFileSync(join(target, "octen-search", ".octen-version"), "main", "utf8");

    const status = skillStatus(target);
    expect(Object.keys(status)).toEqual(["octen-search"]);
  });
});
