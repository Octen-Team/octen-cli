import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as tar from "tar";
import { Command } from "commander";
import { registerConfigureSkills } from "../../src/commands/configureSkills.js";

let tmpDirs: string[] = [];

function makeTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "octen-skill-cmd-"));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const d of tmpDirs) {
    rmSync(d, { recursive: true, force: true });
  }
  tmpDirs = [];
});

function makeProgram(home: string, cwd: string, fetchImpl?: typeof fetch) {
  const prog = new Command();
  prog
    .name("octen")
    .option("--api-key <key>", "Octen API key")
    .option("--base-url <url>", "API base URL")
    .option("--json", "raw JSON output")
    .option("--pretty", "human-readable output")
    .exitOverride();
  registerConfigureSkills(prog, { home, cwd, fetchImpl });
  return prog;
}

/** Build a real .tar.gz Buffer laid out as web-search-skills-<ref>/skills/<name>/SKILL.md */
async function buildTarball(ref: string, skills: string[]): Promise<Buffer> {
  const srcDir = mkdtempSync(join(tmpdir(), "octen-skill-cmd-tarball-"));
  tmpDirs.push(srcDir);
  for (const name of skills) {
    mkdirSync(join(srcDir, `web-search-skills-${ref}`, "skills", name), {
      recursive: true,
    });
    writeFileSync(
      join(srcDir, `web-search-skills-${ref}`, "skills", name, "SKILL.md"),
      `# ${name}\n`,
    );
  }

  const tarDir = mkdtempSync(join(tmpdir(), "octen-skill-cmd-tar-"));
  tmpDirs.push(tarDir);
  const tarPath = join(tarDir, `${ref}.tar.gz`);
  await tar.create(
    { gzip: true, file: tarPath, cwd: srcDir },
    [`web-search-skills-${ref}`],
  );

  return readFileSync(tarPath);
}

describe("configure-skills --cursor --offline", () => {
  it("installs bundled octen-* skills into temp ~/.cursor/skills", async () => {
    const home = makeTmp();
    const cwd = home;
    const prog = makeProgram(home, cwd);

    await prog.parseAsync([
      "node", "octen", "configure-skills", "--cursor", "--offline",
    ]);

    const skillsDir = join(home, ".cursor/skills");
    // At least one octen-* skill should be installed
    const hasOctenSearch = existsSync(join(skillsDir, "octen-search", "SKILL.md"));
    const hasOctenWebSearch = existsSync(join(skillsDir, "octen-web-search", "SKILL.md"));
    expect(hasOctenSearch || hasOctenWebSearch).toBe(true);
  });

  it("writes .octen-version to each installed skill", async () => {
    const home = makeTmp();
    const prog = makeProgram(home, home);

    await prog.parseAsync([
      "node", "octen", "configure-skills", "--cursor", "--offline", "--ref", "main",
    ]);

    const skillsDir = join(home, ".cursor/skills");
    // Check .octen-version in installed skills
    if (existsSync(join(skillsDir, "octen-search"))) {
      const ver = readFileSync(join(skillsDir, "octen-search", ".octen-version"), "utf8");
      expect(ver).toBe("main");
    }
    if (existsSync(join(skillsDir, "octen-web-search"))) {
      const ver = readFileSync(
        join(skillsDir, "octen-web-search", ".octen-version"),
        "utf8",
      );
      expect(ver).toBe("main");
    }
  });
});

describe("configure-skills --claude-code --offline", () => {
  it("installs bundled skills into temp ~/.claude/skills", async () => {
    const home = makeTmp();
    const prog = makeProgram(home, home);

    await prog.parseAsync([
      "node", "octen", "configure-skills", "--claude-code", "--offline",
    ]);

    const skillsDir = join(home, ".claude/skills");
    expect(existsSync(skillsDir)).toBe(true);
  });
});

describe("configure-skills --all --offline", () => {
  it("installs bundled skills into all 5 client dirs", async () => {
    const home = makeTmp();
    const prog = makeProgram(home, home);

    await prog.parseAsync([
      "node", "octen", "configure-skills", "--all", "--offline",
    ]);

    // At least claude-code and cursor should be written
    expect(existsSync(join(home, ".claude/skills"))).toBe(true);
    expect(existsSync(join(home, ".cursor/skills"))).toBe(true);
    expect(existsSync(join(home, ".codex/skills"))).toBe(true);
    expect(existsSync(join(home, ".openclaw/skills"))).toBe(true);
    expect(existsSync(join(home, ".hermes/skills"))).toBe(true);
  });
});

describe("configure-skills --only flag", () => {
  it("installs only specified skill name", async () => {
    const home = makeTmp();
    const prog = makeProgram(home, home);

    await prog.parseAsync([
      "node", "octen", "configure-skills", "--cursor", "--offline",
      "--only", "octen-search",
    ]);

    const skillsDir = join(home, ".cursor/skills");
    expect(existsSync(join(skillsDir, "octen-search"))).toBe(true);
    // octen-web-search should NOT be installed
    expect(existsSync(join(skillsDir, "octen-web-search"))).toBe(false);
  });
});

describe("configure-skills project scope", () => {
  it("installs into <cwd>/.cursor/skills with --scope project", async () => {
    const home = makeTmp();
    const cwd = makeTmp();
    const prog = makeProgram(home, cwd);

    await prog.parseAsync([
      "node", "octen", "configure-skills", "--cursor", "--offline",
      "--scope", "project",
    ]);

    const projectSkillsDir = join(cwd, ".cursor/skills");
    expect(existsSync(projectSkillsDir)).toBe(true);
    // user skills dir should NOT be created
    expect(existsSync(join(home, ".cursor/skills"))).toBe(false);
  });
});

describe("configure-skills status mode (no client flags)", () => {
  it("prints status for each client without throwing", async () => {
    const home = makeTmp();
    const prog = makeProgram(home, home);

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await prog.parseAsync(["node", "octen", "configure-skills"]);

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    // Should mention all 5 clients
    expect(output).toMatch(/Claude Code/);
    expect(output).toMatch(/Cursor/);
    expect(output).toMatch(/Codex/);
    expect(output).toMatch(/OpenClaw/);
    expect(output).toMatch(/Hermes/);
    // All should show "no octen skills installed" since temp dir is empty
    expect(output).toMatch(/no octen skills installed/);
  });

  it("status mode shows installed skill version after install", async () => {
    const home = makeTmp();
    const prog = makeProgram(home, home);

    // First install
    await prog.parseAsync([
      "node", "octen", "configure-skills", "--cursor", "--offline",
    ]);

    // Then check status
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const prog2 = makeProgram(home, home);
    await prog2.parseAsync(["node", "octen", "configure-skills"]);

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    // Cursor should show installed skills with version
    expect(output).toMatch(/Cursor/);
    expect(output).toMatch(/octen-/);
    expect(output).toMatch(/@main/);
  });
});

describe("configure-skills output messages", () => {
  it("prints OCTEN_API_KEY reminder after install", async () => {
    const home = makeTmp();
    const prog = makeProgram(home, home);

    const stdoutLines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdoutLines.push(String(chunk));
      return true;
    });

    await prog.parseAsync([
      "node", "octen", "configure-skills", "--cursor", "--offline",
    ]);

    const output = stdoutLines.join("");
    expect(output).toMatch(/OCTEN_API_KEY/);
    expect(output).toMatch(/octen\.ai/);
  });
});

describe("configure-skills default remote path", () => {
  it("installs skills from remote tarball when no --offline flag is given", async () => {
    const home = makeTmp();
    const cwd = home;

    const ref = "main";
    const buffer = await buildTarball(ref, ["octen-search"]);

    const fetchImpl = async (_url: string): Promise<Response> => {
      return new Response(buffer);
    };

    const prog = makeProgram(home, cwd, fetchImpl as typeof fetch);

    const stdoutLines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdoutLines.push(String(chunk));
      return true;
    });

    await prog.parseAsync([
      "node", "octen", "configure-skills", "--cursor", "--api-key", "k",
    ]);

    // Skill should be installed into temp ~/.cursor/skills/octen-search/
    const skillsDir = join(home, ".cursor/skills");
    expect(existsSync(join(skillsDir, "octen-search", "SKILL.md"))).toBe(true);

    // Output must mention remote source
    const output = stdoutLines.join("");
    expect(output).toMatch(/source: remote/);
  });
});
