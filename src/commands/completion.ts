import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import type { Command, Option } from "commander";
import { OctenValidationError } from "../api/errors.js";
import { quotePath } from "../util/quotePath.js";

const SUPPORTED_SHELLS = ["bash", "zsh", "fish"] as const;
type Shell = (typeof SUPPORTED_SHELLS)[number];

interface CompletionModel {
  /** All subcommand names, e.g. ["search", "fetch", ...]. */
  subcommands: string[];
  /** Global flags in `--flag` / `-f` form. */
  globalFlags: string[];
  /** Map of subcommand name → its flags in `--flag` / `-f` form. */
  subFlags: Record<string, string[]>;
}

/** Collect long/short flag tokens (e.g. "--count", "-n") from a list of options. */
function flagsFor(options: readonly Option[]): string[] {
  const out: string[] = [];
  for (const opt of options) {
    if (opt.long) out.push(opt.long);
    if (opt.short) out.push(opt.short);
  }
  return out;
}

/** Introspect the root program into a shell-agnostic completion model. */
function buildModel(program: Command): CompletionModel {
  const subcommands = program.commands.map((c) => c.name());
  const globalFlags = flagsFor(program.options);
  const subFlags: Record<string, string[]> = {};
  for (const cmd of program.commands) {
    subFlags[cmd.name()] = flagsFor(cmd.options);
  }
  return { subcommands, globalFlags, subFlags };
}

/**
 * The shared bash `_octen` completion function, reused verbatim by the zsh
 * script (via bashcompinit). Returns the full function plus `complete` line.
 */
function bashFunction(model: CompletionModel): string {
  const subs = model.subcommands.join(" ");
  const globals = model.globalFlags.join(" ");

  // Build the case branches for per-subcommand flag completion.
  const branches = model.subcommands
    .map((sub) => {
      const flags = [...(model.subFlags[sub] ?? []), ...model.globalFlags].join(" ");
      return `    ${sub})\n      opts="${flags}"\n      ;;`;
    })
    .join("\n");

  return `_octen() {
  local cur sub i opts
  cur="\${COMP_WORDS[COMP_CWORD]}"
  sub=""
  for (( i=1; i < COMP_CWORD; i++ )); do
    case "\${COMP_WORDS[i]}" in
      -*) ;;
      *) sub="\${COMP_WORDS[i]}"; break ;;
    esac
  done
  if [ -z "$sub" ]; then
    opts="${subs} ${globals}"
  else
    case "$sub" in
${branches}
    *)
      opts="${globals}"
      ;;
    esac
  fi
  COMPREPLY=( $(compgen -W "$opts" -- "$cur") )
  return 0
}
complete -F _octen octen`;
}

function bashScript(model: CompletionModel): string {
  return `#!/usr/bin/env bash\n# octen bash completion. Source via: eval "$(octen completion bash)"\n${bashFunction(model)}\n`;
}

function zshScript(model: CompletionModel): string {
  // Reuse the bash function through zsh's bashcompinit shim. This is reliable
  // and stays in sync with the bash implementation.
  return `#compdef octen\n# octen zsh completion. Source via: eval "$(octen completion zsh)"\nif ! whence -w bashcompinit >/dev/null 2>&1; then\n  autoload -Uz bashcompinit\nfi\nbashcompinit\n${bashFunction(model)}\n`;
}

/** Strip leading dashes for fish's `-l`/`-s` which want bare names. */
function fishFlagArgs(flags: string[]): string {
  return flags
    .map((f) => {
      if (f.startsWith("--")) return `-l ${f.slice(2)}`;
      if (f.startsWith("-")) return `-s ${f.slice(1)}`;
      return `-l ${f}`;
    })
    .join(" ");
}

function fishScript(model: CompletionModel): string {
  const lines: string[] = [
    "# octen fish completion.",
    "# Install via: octen completion fish > ~/.config/fish/completions/octen.fish",
  ];
  // Subcommands (only when no subcommand has been seen yet).
  lines.push(
    `complete -c octen -f -n '__fish_use_subcommand' -a '${model.subcommands.join(" ")}'`,
  );
  // Global flags, always available.
  for (const sub of model.subcommands) {
    const flagArgs = fishFlagArgs(model.subFlags[sub] ?? []);
    if (flagArgs) {
      lines.push(
        `complete -c octen -n '__fish_seen_subcommand_from ${sub}' ${flagArgs}`,
      );
    }
  }
  const globalArgs = fishFlagArgs(model.globalFlags);
  if (globalArgs) {
    lines.push(`complete -c octen ${globalArgs}`);
  }
  return lines.join("\n") + "\n";
}

export function buildCompletionScript(program: Command, shell: string): string {
  const model = buildModel(program);
  switch (shell as Shell) {
    case "bash":
      return bashScript(model);
    case "zsh":
      return zshScript(model);
    case "fish":
      return fishScript(model);
    default:
      throw new OctenValidationError(
        `unsupported shell: ${shell} (supported: ${SUPPORTED_SHELLS.join(", ")})`,
      );
  }
}

interface CompletionInternalOpts {
  /** Injected home dir (for testing); defaults to os.homedir() */
  home?: string;
}

/**
 * Persist completion into the user's shell config.
 * - bash/zsh: append an idempotent `eval "$(octen completion <shell>)"` line to
 *   the rc file, so it stays in sync with the CLI and loads in new shells.
 * - fish: write the generated script into the auto-loaded completions dir.
 */
function installCompletion(
  shell: Shell,
  program: Command,
  home: string,
): { action: "installed" | "already" | "written"; path: string } {
  if (shell === "fish") {
    const dir = join(home, ".config/fish/completions");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "octen.fish");
    writeFileSync(file, buildCompletionScript(program, "fish"), "utf8");
    return { action: "written", path: file };
  }

  const rc = shell === "zsh" ? join(home, ".zshrc") : join(home, ".bashrc");
  const line = `eval "$(octen completion ${shell})"`;
  const existing = existsSync(rc) ? readFileSync(rc, "utf8") : "";
  if (existing.includes(line)) {
    return { action: "already", path: rc };
  }
  const prefix = existing === "" || existing.endsWith("\n") ? "" : "\n";
  appendFileSync(rc, `${prefix}\n# octen CLI completion\n${line}\n`, "utf8");
  return { action: "installed", path: rc };
}

export function registerCompletion(program: Command, internal: CompletionInternalOpts = {}) {
  program
    .command("completion")
    .argument("<shell>", "bash | zsh | fish")
    .description("Output a shell completion script (or --install it into your shell config)")
    .option("--install", "write the completion into your shell config instead of printing")
    .action((shell: string, opts: { install?: boolean }) => {
      // Validates the shell (throws OctenValidationError for unknown shells).
      const script = buildCompletionScript(program, shell);

      if (!opts.install) {
        process.stdout.write(script);
        return;
      }

      const home = internal.home ?? os.homedir();
      const result = installCompletion(shell as Shell, program, home);
      if (result.action === "already") {
        process.stdout.write(`completion already installed in ${quotePath(result.path)}\n`);
      } else if (result.action === "written") {
        process.stdout.write(
          `wrote fish completion to ${quotePath(result.path)} (new shells pick it up automatically)\n`,
        );
      } else {
        process.stdout.write(`added octen completion to ${quotePath(result.path)}\n`);
      }
      if (shell !== "fish") {
        const rc = shell === "zsh" ? "~/.zshrc" : "~/.bashrc";
        process.stdout.write(
          `run \`source ${rc}\` (or open a new terminal) to activate it now\n`,
        );
      }
    });
}
