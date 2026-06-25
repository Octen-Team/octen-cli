import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as tar from "tar";
import { resolveSkillsDir } from "../../src/skills/source.js";

let tmpDirs: string[] = [];

function makeTmp(): string {
  const d = mkdtempSync(join(tmpdir(), "octen-src-"));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs) {
    rmSync(d, { recursive: true, force: true });
  }
  tmpDirs = [];
});

/** Build a real .tar.gz Buffer laid out as web-search-skills-<ref>/skills/<name>/SKILL.md */
async function buildTarball(ref: string, skills: string[]): Promise<Buffer> {
  const srcDir = makeTmp();
  for (const name of skills) {
    mkdirSync(join(srcDir, `web-search-skills-${ref}`, "skills", name), {
      recursive: true,
    });
    writeFileSync(
      join(srcDir, `web-search-skills-${ref}`, "skills", name, "SKILL.md"),
      `# ${name}\n`,
    );
  }

  const tarPath = join(makeTmp(), `${ref}.tar.gz`);
  await tar.create(
    { gzip: true, file: tarPath, cwd: srcDir },
    [`web-search-skills-${ref}`],
  );

  const { readFileSync } = await import("node:fs");
  return readFileSync(tarPath);
}

describe("resolveSkillsDir – offline mode", () => {
  it("returns bundled dir immediately without fetching", async () => {
    const bundledDir = makeTmp();
    const cacheDir = makeTmp();

    const fetchImpl = async (_url: string): Promise<Response> => {
      throw new Error("should not be called");
    };

    const result = await resolveSkillsDir({
      ref: "main",
      offline: true,
      cacheDir,
      bundledDir,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result.source).toBe("bundled");
    expect(result.dir).toBe(bundledDir);
  });
});

describe("resolveSkillsDir – fetchImpl throws", () => {
  it("falls back to bundled and prints warning", async () => {
    const bundledDir = makeTmp();
    const cacheDir = makeTmp();

    const stderrLines: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as any).write = (chunk: unknown) => {
      stderrLines.push(String(chunk));
      return true;
    };

    try {
      const fetchImpl = async (): Promise<Response> => {
        throw new Error("network error");
      };

      const result = await resolveSkillsDir({
        ref: "main",
        offline: false,
        cacheDir,
        bundledDir,
        fetchImpl: fetchImpl as typeof fetch,
      });

      expect(result.source).toBe("bundled");
      expect(result.dir).toBe(bundledDir);
      const combined = stderrLines.join("");
      expect(combined).toMatch(/warning/);
      expect(combined).toMatch(/bundled/);
    } finally {
      (process.stderr as any).write = origWrite;
    }
  });
});

describe("resolveSkillsDir – happy path (real tarball)", () => {
  it("extracts tarball and returns remote skills dir containing octen-* subdirs", async () => {
    const bundledDir = makeTmp();
    const cacheDir = makeTmp();

    const ref = "main";
    const buffer = await buildTarball(ref, ["octen-search", "octen-web-search"]);

    const fetchImpl = async (_url: string): Promise<Response> => {
      return new Response(buffer);
    };

    const result = await resolveSkillsDir({
      ref,
      offline: false,
      cacheDir,
      bundledDir,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result.source).toBe("remote");
    // The returned dir must directly contain octen-search and octen-web-search
    expect(existsSync(join(result.dir, "octen-search"))).toBe(true);
    expect(existsSync(join(result.dir, "octen-web-search"))).toBe(true);
    expect(existsSync(join(result.dir, "octen-search", "SKILL.md"))).toBe(true);
    expect(existsSync(join(result.dir, "octen-web-search", "SKILL.md"))).toBe(true);
  });

  it("falls back to bundled if tarball response is not ok", async () => {
    const bundledDir = makeTmp();
    const cacheDir = makeTmp();

    const fetchImpl = async (): Promise<Response> => {
      return new Response("not found", { status: 404 });
    };

    const result = await resolveSkillsDir({
      ref: "main",
      offline: false,
      cacheDir,
      bundledDir,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result.source).toBe("bundled");
    expect(result.dir).toBe(bundledDir);
  });
});
