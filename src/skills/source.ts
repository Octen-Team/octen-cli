import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import * as tar from "tar";
import { SKILLS_REPO_TARBALL } from "../api/constants.js";
import { OctenValidationError } from "../api/errors.js";

export interface ResolveOpts {
  ref: string;
  offline: boolean;
  cacheDir: string;
  bundledDir: string;
  fetchImpl?: typeof fetch;
}

export interface ResolveResult {
  dir: string;
  source: "remote" | "bundled";
}

export async function resolveSkillsDir(o: ResolveOpts): Promise<ResolveResult> {
  if (o.offline) {
    return { dir: o.bundledDir, source: "bundled" };
  }

  // Validate ref before use in paths/URLs to prevent traversal or malformed URLs.
  // Must match /^[\w.\/-]+$/ AND must not contain the ".." sequence.
  // (Validated once up-front; a bad ref is a hard error, never retried/fallback.)
  if (!/^[\w.\/-]+$/.test(o.ref) || o.ref.includes("..")) {
    throw new OctenValidationError(`invalid ref: ${o.ref}`);
  }

  // Retry transient fetch/extract failures (e.g. a single "fetch failed" blip)
  // a few times before falling back to bundled skills.
  const MAX_ATTEMPTS = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fetchRemoteSkills(o);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(500 * attempt);
      }
    }
  }

  const cause =
    (lastErr as any)?.cause?.code ??
    (lastErr as any)?.cause?.message ??
    (lastErr instanceof Error ? lastErr.message : String(lastErr));
  process.stderr.write(
    `warning: failed to fetch skills from GitHub (${cause}) — using bundled fallback\n`,
  );
  return { dir: o.bundledDir, source: "bundled" };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** One attempt: fetch the tarball, extract it, and locate the skills/ dir. */
async function fetchRemoteSkills(o: ResolveOpts): Promise<ResolveResult> {
  const fetcher = o.fetchImpl ?? fetch;
  const url = SKILLS_REPO_TARBALL(o.ref);
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  // Write tarball to a collision-resistant temp file for tar.extract (which needs a file path)
  const tmpTar = join(tmpdir(), `octen-skills-${randomUUID()}.tar.gz`);
  writeFileSync(tmpTar, buffer);

  // Extract into a clean cacheDir/<ref>/ (clean so a prior run, possibly from a
  // differently-named archive root, can't leave a stale dir behind).
  const extractDir = join(o.cacheDir, o.ref);
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });

  try {
    await tar.extract({ file: tmpTar, cwd: extractDir });
  } finally {
    rmSync(tmpTar, { force: true });
  }

  // GitHub archive tarballs nest everything under a single top-level dir named
  // <repo>-<ref>. The repo can be renamed (the download follows GitHub's
  // redirect), so DISCOVER that root dir rather than hardcoding the repo name.
  const roots = readdirSync(extractDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (roots.length !== 1) {
    throw new Error(`unexpected archive layout: ${roots.length} top-level dirs`);
  }
  const skillsDir = join(extractDir, roots[0].name, "skills");

  // Verify the skills/ subdir exists
  readdirSync(skillsDir);

  return { dir: skillsDir, source: "remote" };
}
