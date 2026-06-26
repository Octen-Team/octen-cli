/**
 * sync-skills.ts
 *
 * Maintainer script: downloads the upstream skills tarball at a given ref
 * and copies the octen-* skills into this package's skills/ directory,
 * updating skills/manifest.json.
 *
 * Usage:
 *   npm run sync-skills                  # sync from main
 *   npm run sync-skills -- --ref v1.2.3  # sync a specific tag/ref
 *
 * Run via: tsx scripts/sync-skills.ts
 */

import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import * as tar from "tar";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

// Inline SKILLS_REPO and SKILLS_REPO_TARBALL to avoid src/ imports that
// would require tsconfig include paths — scripts/ is excluded from tsconfig.
const SKILLS_REPO = "Octen-Team/octen-skills";
const SKILLS_REPO_TARBALL = (ref: string) =>
  `https://github.com/${SKILLS_REPO}/archive/${ref}.tar.gz`;

// Parse --ref argument
const args = process.argv.slice(2);
const refIndex = args.indexOf("--ref");
const ref = refIndex >= 0 ? args[refIndex + 1] : "main";

if (!ref) {
  process.stderr.write("error: --ref requires a value\n");
  process.exit(1);
}

// Package skills/ dir (sibling of scripts/)
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const skillsDir = join(packageRoot, "skills");

async function main(): Promise<void> {
  const url = SKILLS_REPO_TARBALL(ref);
  process.stdout.write(`Fetching ${url}\n`);

  const response = await fetch(url);
  if (!response.ok) {
    process.stderr.write(`error: HTTP ${response.status} fetching ${url}\n`);
    process.exit(1);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  // Write to temp file
  const tmpDir = join(tmpdir(), `octen-sync-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  const tmpTar = join(tmpDir, `${ref}.tar.gz`);
  writeFileSync(tmpTar, buffer);

  // Extract
  await tar.extract({ file: tmpTar, cwd: tmpDir });

  // Locate skills/ inside the tarball. GitHub archives nest under a single
  // <repo>-<ref> dir; the repo can be renamed, so discover that root dir.
  const roots = readdirSync(tmpDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (roots.length !== 1) {
    process.stderr.write(`error: unexpected archive layout (${roots.length} top-level dirs)\n`);
    process.exit(1);
  }
  const srcSkillsDir = join(tmpDir, roots[0].name, "skills");

  const entries = readdirSync(srcSkillsDir, { withFileTypes: true });
  const octenSkills = entries
    .filter((e) => e.isDirectory() && e.name.startsWith("octen-"))
    .map((e) => e.name);

  if (octenSkills.length === 0) {
    process.stderr.write(`warning: no octen-* skills found in tarball at ref "${ref}"\n`);
  }

  // Prune bundled octen-* skills no longer present upstream.
  for (const e of readdirSync(skillsDir, { withFileTypes: true })) {
    if (e.isDirectory() && e.name.startsWith("octen-") && !octenSkills.includes(e.name)) {
      rmSync(join(skillsDir, e.name), { recursive: true, force: true });
      process.stdout.write(`  pruned: ${e.name}\n`);
    }
  }

  // Copy each octen-* skill into the package skills/ dir (overwrite)
  for (const name of octenSkills) {
    const src = join(srcSkillsDir, name);
    const dest = join(skillsDir, name);
    // Remove existing copy first to avoid stale files
    rmSync(dest, { recursive: true, force: true });
    cpSync(src, dest, { recursive: true });
    process.stdout.write(`  synced: ${name}\n`);
  }

  // Update manifest.json
  const manifest = {
    source: SKILLS_REPO,
    ref,
    skills: octenSkills,
  };
  writeFileSync(join(skillsDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  process.stdout.write(`Updated skills/manifest.json (ref: ${ref}, skills: ${octenSkills.join(", ")})\n`);

  // Clean up temp dir
  rmSync(tmpDir, { recursive: true, force: true });
}

main().catch((err: unknown) => {
  process.stderr.write(
    `error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
