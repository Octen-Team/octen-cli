import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pc from "picocolors";
import type { Command } from "commander";
import { SKILL_CLIENTS } from "../skills/clients.js";
import { resolveSkillsDir } from "../skills/source.js";
import { installSkills, skillStatus } from "../skills/install.js";

interface ConfigureSkillsInternalOpts {
  /** Injected home dir (for testing); defaults to os.homedir() */
  home?: string;
  /** Injected cwd (for testing); defaults to process.cwd() */
  cwd?: string;
  /** Injected fetch implementation (for testing); defaults to global fetch */
  fetchImpl?: typeof fetch;
}

// Exported so tests can call with injected dirs
export function registerConfigureSkills(
  program: Command,
  internal: ConfigureSkillsInternalOpts = {},
): void {
  program
    .command("configure-skills")
    .description("Install Octen Agent Skills into AI clients")
    .option("--all", "install into all supported clients")
    .option("--claude-code", "install into Claude Code")
    .option("--cursor", "install into Cursor")
    .option("--codex", "install into Codex")
    .option("--openclaw", "install into OpenClaw")
    .option("--hermes", "install into Hermes")
    .option("--skills-dir <path>", "use a custom skills source directory")
    .option(
      "--scope <s>",
      "config scope: user | project (default: user)",
      "user",
    )
    .option(
      "--only <names>",
      "comma-separated list of skill names to install (e.g. octen-search,octen-web-search)",
    )
    .option("--ref <ref>", "upstream git ref to fetch skills from", "main")
    .option("--bundled", "force use of bundled (vendored) skills — no network")
    .option("--offline", "alias for --bundled")
    .action(async (_opts: Record<string, any>, command: Command) => {
      const opts = command.opts() as {
        all?: boolean;
        claudeCode?: boolean;
        cursor?: boolean;
        codex?: boolean;
        openclaw?: boolean;
        hermes?: boolean;
        skillsDir?: string;
        scope: string;
        only?: string;
        ref: string;
        bundled?: boolean;
        offline?: boolean;
      };

      const scope = (opts.scope === "project" ? "project" : "user") as
        | "user"
        | "project";
      const ref = opts.ref;
      const offline = !!(opts.bundled || opts.offline);
      const only = opts.only
        ? opts.only.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;

      const home = internal.home ?? os.homedir();
      const cwd = internal.cwd ?? process.cwd();

      // Both dist/commands/ (published) and src/commands/ (tsx tests) are two levels below the
      // package root, so ../../skills resolves to the package-root skills/ dir in both.
      const bundledDir = fileURLToPath(
        new URL("../../skills", import.meta.url),
      );
      const cacheDir = join(home, ".cache/octen-cli/skills");

      // Determine selected clients
      const clientFlagMap: Record<string, string> = {
        "claude-code": "claudeCode",
        cursor: "cursor",
        codex: "codex",
        openclaw: "openclaw",
        hermes: "hermes",
      };

      const anySelected =
        opts.all ||
        opts.claudeCode ||
        opts.cursor ||
        opts.codex ||
        opts.openclaw ||
        opts.hermes;

      if (!anySelected) {
        // STATUS MODE: show installed octen-* skills per client
        for (const client of SKILL_CLIENTS) {
          const skillsDir = client.dirFor(scope, home, cwd);
          const status = skillStatus(skillsDir);
          const names = Object.keys(status);
          if (names.length === 0) {
            process.stdout.write(`${client.label}: no octen skills installed\n`);
          } else {
            const detail = names
              .map((n) => `${n}@${status[n] ?? "unknown"}`)
              .join(", ");
            process.stdout.write(`${client.label}: ${detail}\n`);
          }
        }
        return;
      }

      // INSTALL MODE
      const selected = opts.all
        ? SKILL_CLIENTS
        : SKILL_CLIENTS.filter((c) => {
            const flagName = clientFlagMap[c.id];
            return flagName
              ? Boolean((opts as Record<string, unknown>)[flagName])
              : false;
          });

      // Resolve skills source (custom dir, or remote/bundled)
      let srcDir: string;
      let source: "remote" | "bundled" | "custom";

      if (opts.skillsDir) {
        srcDir = opts.skillsDir;
        source = "custom";
      } else {
        const resolved = await resolveSkillsDir({
          ref,
          offline,
          cacheDir,
          bundledDir,
          fetchImpl: internal.fetchImpl,
        });
        srcDir = resolved.dir;
        source = resolved.source;
      }

      let anyFailed = false;

      for (const client of selected) {
        const targetDir = client.dirFor(scope, home, cwd);
        try {
          const installed = installSkills(srcDir, targetDir, ref, only);
          const skillList = installed.length > 0 ? installed.join(", ") : "(none)";
          process.stdout.write(
            `${client.label}: installed [${skillList}] → ${targetDir} (source: ${source})\n`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(
            pc.red(`error installing skills for ${client.label}: ${msg}`) + "\n",
          );
          anyFailed = true;
        }
      }

      if (anyFailed) {
        process.exitCode = 1;
      }

      // Print API key setup reminder
      process.stdout.write(
        "\nSet OCTEN_API_KEY in each client's environment — see https://octen.ai\n",
      );
    });
}
