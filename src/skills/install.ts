import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/**
 * Install octen-* skills from srcDir into targetSkillsDir.
 * If `only` is given, only those skill names are installed.
 * Returns the list of installed skill names.
 */
export function installSkills(
  srcDir: string,
  targetSkillsDir: string,
  ref: string,
  only?: string[],
): string[] {
  mkdirSync(targetSkillsDir, { recursive: true });

  const entries = readdirSync(srcDir, { withFileTypes: true });
  const installed: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (!name.startsWith("octen-")) continue;
    if (only && !only.includes(name)) continue;

    const src = join(srcDir, name);
    const dest = join(targetSkillsDir, name);

    // Remove existing skill dir so the install is clean (no stale files linger)
    rmSync(dest, { recursive: true, force: true });
    cpSync(src, dest, { recursive: true });

    // Write version marker
    writeFileSync(join(dest, ".octen-version"), ref, "utf8");

    installed.push(name);
  }

  return installed;
}

/**
 * Returns a map of installed octen-* skill names to their .octen-version
 * content (or null if the marker file is absent).
 */
export function skillStatus(
  targetSkillsDir: string,
): Record<string, string | null> {
  if (!existsSync(targetSkillsDir)) return {};

  const entries = readdirSync(targetSkillsDir, { withFileTypes: true });
  const result: Record<string, string | null> = {};

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (!name.startsWith("octen-")) continue;

    const versionFile = join(targetSkillsDir, name, ".octen-version");
    if (existsSync(versionFile)) {
      result[name] = readFileSync(versionFile, "utf8").trim();
    } else {
      result[name] = null;
    }
  }

  return result;
}
