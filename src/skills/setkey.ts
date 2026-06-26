import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse, stringify } from "smol-toml";
import { OctenValidationError } from "../api/errors.js";

export type SetKeyResult = {
  clientId: string;
  written: boolean;
  path?: string;
  hint?: string;
};

const SHELL_PROFILE_HINT =
  "Set OCTEN_API_KEY in your shell profile (e.g. ~/.zshrc: export OCTEN_API_KEY=...) or use direnv";

type JsonObj = Record<string, unknown>;

function readJsonFile(filePath: string): JsonObj {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, "utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as JsonObj;
  } catch (e) {
    throw new OctenValidationError(
      `Config file ${filePath} contains invalid JSON and cannot be edited safely. Fix or remove it, then retry. (${(e as Error).message})`,
    );
  }
}

function readTomlFile(filePath: string): JsonObj {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, "utf8").trim();
  if (!raw) return {};
  try {
    return parse(raw) as JsonObj;
  } catch (e) {
    throw new OctenValidationError(
      `Config file ${filePath} contains invalid TOML and cannot be edited safely. Fix or remove it, then retry. (${(e as Error).message})`,
    );
  }
}

/**
 * Write OCTEN_API_KEY into a client's env configuration, merging with any
 * existing content (never clobbering unrelated keys). Returns whether a file
 * was written; for clients without an env config file, returns a shell-profile
 * hint instead of editing rc files.
 */
export function setClientEnvKey(
  clientId: string,
  key: string,
  scope: "user" | "project",
  home: string,
  cwd: string,
): SetKeyResult {
  switch (clientId) {
    case "claude-code": {
      const path =
        scope === "project"
          ? join(cwd, ".claude/settings.json")
          : join(home, ".claude/settings.json");
      const obj = readJsonFile(path);
      obj.env = {
        ...((obj.env as JsonObj | undefined) ?? {}),
        OCTEN_API_KEY: key,
      };
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf8");
      return { clientId, written: true, path };
    }
    case "codex": {
      const path = join(home, ".codex/config.toml");
      const obj = readTomlFile(path);
      const policy = (obj.shell_environment_policy ??= {} as JsonObj) as JsonObj;
      policy.set = {
        ...((policy.set as JsonObj | undefined) ?? {}),
        OCTEN_API_KEY: key,
      };
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, stringify(obj), "utf8");
      return { clientId, written: true, path };
    }
    case "openclaw": {
      const path = join(home, ".openclaw/.env");
      const raw = existsSync(path) ? readFileSync(path, "utf8") : "";
      const lines = raw === "" ? [] : raw.replace(/\n+$/, "").split("\n");
      let replaced = false;
      for (let i = 0; i < lines.length; i++) {
        if (/^OCTEN_API_KEY=/.test(lines[i])) {
          lines[i] = `OCTEN_API_KEY=${key}`;
          replaced = true;
          break;
        }
      }
      if (!replaced) lines.push(`OCTEN_API_KEY=${key}`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, lines.join("\n") + "\n", "utf8");
      return { clientId, written: true, path };
    }
    default:
      return { clientId, written: false, hint: SHELL_PROFILE_HINT };
  }
}
