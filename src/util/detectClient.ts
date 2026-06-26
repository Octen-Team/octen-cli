import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

export interface DetectOpts {
  /** Test injection: explicit installed map keyed by client id */
  installed?: Record<string, boolean>;
  /** Injected home dir (for testing); defaults to os.homedir() */
  home?: string;
}

/** Returns true if `bin` is resolvable on PATH (via `which`). */
function binOnPath(bin: string): boolean {
  try {
    execFileSync("which", [bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Returns true if a macOS app bundle named `<name>.app` exists in /Applications. */
function appExists(name: string): boolean {
  return existsSync(`/Applications/${name}.app`);
}

/**
 * Detect whether a given client is installed on this machine.
 *
 * Detection deliberately relies on the client's own binary, app bundle, or a
 * config file the client itself creates — never on directories that octen-cli
 * creates (e.g. ~/.cursor/skills), which would produce false positives.
 *
 * Unknown ids return true so we never block clients we don't have a signal for.
 */
export function isClientInstalled(id: string, opts?: DetectOpts): boolean {
  if (opts?.installed && Object.prototype.hasOwnProperty.call(opts.installed, id)) {
    return opts.installed[id];
  }

  const home = opts?.home ?? os.homedir();

  switch (id) {
    case "claude-code":
      return binOnPath("claude") || existsSync(join(home, ".claude.json"));
    case "cursor":
      return binOnPath("cursor") || appExists("Cursor");
    case "codex":
      return binOnPath("codex") || existsSync(join(home, ".codex/config.toml"));
    case "openclaw":
      return binOnPath("openclaw") || binOnPath("claw");
    case "hermes":
      return binOnPath("hermes");
    case "claude-desktop":
      return (
        appExists("Claude") ||
        existsSync(join(home, "Library/Application Support/Claude"))
      );
    case "windsurf":
      return (
        binOnPath("windsurf") ||
        appExists("Windsurf") ||
        existsSync(join(home, ".codeium/windsurf"))
      );
    case "vscode":
      return binOnPath("code") || appExists("Visual Studio Code");
    default:
      // Unknown id — don't block.
      return true;
  }
}
