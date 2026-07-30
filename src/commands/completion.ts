import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import type { Command, Option } from "commander";
import { OctenValidationError } from "../api/errors.js";
import { quotePath } from "../util/quotePath.js";

const SUPPORTED_SHELLS = ["bash", "zsh", "fish"] as const;
type Shell = (typeof SUPPORTED_SHELLS)[number];

interface CompletionModel {
  /** All subcommand names, e.g. ["search", "extract", ...]. */
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
  // and stays in sync with the bash implementation. bashcompinit depends on the
  // zsh completion system, so initialize compinit first if the user's shell
  // hasn't already (makes a bare `source`/`eval` work without extra setup).
  const preamble = [
    "#compdef octen",
    '# octen zsh completion. Source via: eval "$(octen completion zsh)"',
    "if ! whence compdef >/dev/null 2>&1; then",
    "  autoload -Uz compinit && compinit -u",
    "fi",
    "autoload -Uz bashcompinit && bashcompinit",
  ].join("\n");
  return `${preamble}\n${bashFunction(model)}\n`;
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

/**
 * A native zsh completion function — a `#compdef octen` file meant to live on
 * `fpath` and be autoloaded by `compinit`. Unlike the `bashcompinit` `eval` shim,
 * a file on `fpath` is re-discovered every time `compinit` runs, so a later
 * `compinit` (e.g. appended by another tool's installer) reloads it instead of
 * silently dropping the registration. This is the order-robust install target.
 */
function zshCompletionFile(model: CompletionModel): string {
  const subs = model.subcommands.join(" ");
  const globals = model.globalFlags.join(" ");
  const branches = model.subcommands
    .map((sub) => {
      const flags = [...(model.subFlags[sub] ?? []), ...model.globalFlags].join(" ");
      return `    ${sub})\n      opts="${flags}"\n      ;;`;
    })
    .join("\n");

  return `#compdef octen
# octen zsh completion (native, fpath-autoloaded). Do not edit by hand;
# regenerate with: octen completion zsh --install
_octen() {
  local cur sub i opts
  cur=\${words[CURRENT]}
  sub=""
  for (( i = 2; i < CURRENT; i++ )); do
    case \${words[i]} in
      -*) ;;
      *) sub=\${words[i]}; break ;;
    esac
  done
  if [[ -z $sub ]]; then
    opts="${subs} ${globals}"
  else
    case $sub in
${branches}
    *)
      opts="${globals}"
      ;;
    esac
  fi
  compadd -- \${=opts}
}
_octen "$@"
`;
}

/** Native bash completion file body (function + `complete`), for the bash-
 * completion user dir which lazy-loads it on demand regardless of rc ordering. */
function bashCompletionFile(model: CompletionModel): string {
  return `${bashFunction(model)}\n`;
}

const ZSH_BLOCK_START = "# >>> octen completion >>>";
const ZSH_BLOCK_END = "# <<< octen completion <<<";

/** The `~/.zshrc` block that puts our completions dir on `fpath` and (re)runs
 * `compinit` so the `_octen` file is discovered no matter where it lands. */
function zshRcBlock(): string {
  return [
    ZSH_BLOCK_START,
    'fpath=("$HOME/.octen/completions" $fpath)',
    "autoload -Uz compinit && compinit",
    ZSH_BLOCK_END,
  ].join("\n");
}

/** Remove the legacy `# octen CLI completion` + `eval` block older versions
 * appended, so re-running `--install` cleanly upgrades to the fpath approach. */
function stripLegacyEvalBlock(contents: string, shell: "zsh" | "bash"): string {
  const evalLine = `eval "$(octen completion ${shell})"`;
  const legacyBlock = `\n# octen CLI completion\n${evalLine}\n`;
  const withoutBlock = contents.split(legacyBlock).join("");
  // Also drop any bare eval line left on its own (e.g. hand-placed).
  return withoutBlock
    .split("\n")
    .filter((l) => l.trim() !== evalLine)
    .join("\n");
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

interface InstallResult {
  action: "installed" | "already" | "written";
  /** The rc file we edited (zsh), or the completion file we wrote (bash/fish). */
  path: string;
  /** The standalone completion file, when one was written (zsh/bash). */
  file?: string;
}

/**
 * Persist completion into the user's shell so it survives re-initialization.
 * - zsh: write a native `#compdef` `_octen` file into `~/.octen/completions`
 *   (an fpath dir) and ensure `~/.zshrc` adds that dir to `fpath` + runs
 *   `compinit`. Because it lives on `fpath`, a later `compinit` re-discovers it
 *   instead of dropping it — the failure mode of the old `eval` line.
 * - bash: write a native completion file into the bash-completion user dir,
 *   which is lazy-loaded on demand regardless of rc ordering.
 * - fish: write the generated script into the auto-loaded completions dir.
 */
function installCompletion(shell: Shell, program: Command, home: string): InstallResult {
  if (shell === "fish") {
    const dir = join(home, ".config/fish/completions");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "octen.fish");
    writeFileSync(file, buildCompletionScript(program, "fish"), "utf8");
    return { action: "written", path: file };
  }

  const model = buildModel(program);

  if (shell === "zsh") {
    // 1) (Re)write the native completion file into an fpath dir.
    const dir = join(home, ".octen/completions");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "_octen");
    writeFileSync(file, zshCompletionFile(model), "utf8");

    // 2) Ensure ~/.zshrc puts that dir on fpath and runs compinit.
    const rc = join(home, ".zshrc");
    const existing = existsSync(rc) ? readFileSync(rc, "utf8") : "";
    if (existing.includes(ZSH_BLOCK_START)) {
      return { action: "already", path: rc, file };
    }
    const cleaned = stripLegacyEvalBlock(existing, "zsh");
    const prefix = cleaned === "" || cleaned.endsWith("\n") ? "" : "\n";
    writeFileSync(rc, `${cleaned}${prefix}\n${zshRcBlock()}\n`, "utf8");
    return { action: "installed", path: rc, file };
  }

  // bash: drop a native completion file into the bash-completion user dir.
  const dir = join(home, ".local/share/bash-completion/completions");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "octen");
  writeFileSync(file, bashCompletionFile(model), "utf8");
  return { action: "written", path: file };
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

      if (shell === "fish") {
        process.stdout.write(
          `wrote fish completion to ${quotePath(result.path)} (new shells pick it up automatically)\n`,
        );
        return;
      }
      if (shell === "bash") {
        process.stdout.write(
          `wrote octen bash completion to ${quotePath(result.path)} (new shells pick it up automatically)\n`,
        );
        return;
      }
      // zsh: file on fpath + rc block.
      if (result.action === "already") {
        process.stdout.write(
          `octen completion already configured in ${quotePath(result.path)} (refreshed ${quotePath(result.file!)})\n`,
        );
      } else {
        process.stdout.write(
          `installed octen completion: wrote ${quotePath(result.file!)} and updated ${quotePath(result.path)}\n`,
        );
      }
      process.stdout.write(
        "run `source ~/.zshrc` (or open a new terminal) to activate it now\n",
      );
    });
}
