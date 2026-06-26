import os from "node:os";
import pc from "picocolors";
import type { Command } from "commander";
import { MCP_CLIENTS } from "../mcp/clients.js";
import { SKILL_CLIENTS } from "../skills/clients.js";
import { removeMcp, type InstallOpts } from "../mcp/install.js";
import { removeSkills } from "../skills/install.js";
import { quotePath } from "../util/quotePath.js";

interface ResetInternalOpts {
  /** Injected home dir (for testing); defaults to os.homedir() */
  home?: string;
  /** Injected cwd (for testing); defaults to process.cwd() */
  cwd?: string;
  /** Override claude CLI detection (for testing) */
  hasClaudeCli?: boolean;
}

// Maps CLI flag name → client id (shared across both registries)
const CLIENT_FLAG_MAP: Record<string, string> = {
  claudeCode: "claude-code",
  cursor: "cursor",
  claudeDesktop: "claude-desktop",
  windsurf: "windsurf",
  vscode: "vscode",
  codex: "codex",
  openclaw: "openclaw",
  hermes: "hermes",
};

export function registerReset(program: Command, internal: ResetInternalOpts = {}): void {
  program
    .command("reset")
    .description("Remove Octen MCP server and/or skills from AI clients")
    .option("--mcp", "remove MCP entries")
    .option("--skills", "remove skills")
    .option("--all", "remove from both surfaces across all clients")
    .option("--claude-code", "target Claude Code")
    .option("--cursor", "target Cursor")
    .option("--claude-desktop", "target Claude Desktop")
    .option("--windsurf", "target Windsurf")
    .option("--vscode", "target VS Code")
    .option("--codex", "target Codex")
    .option("--openclaw", "target OpenClaw")
    .option("--hermes", "target Hermes")
    .option(
      "--scope <s>",
      "config scope: user | project (default: user)",
      "user",
    )
    .action((_opts: Record<string, any>, command: Command) => {
      const opts = command.opts() as {
        mcp?: boolean;
        skills?: boolean;
        all?: boolean;
        claudeCode?: boolean;
        cursor?: boolean;
        claudeDesktop?: boolean;
        windsurf?: boolean;
        vscode?: boolean;
        codex?: boolean;
        openclaw?: boolean;
        hermes?: boolean;
        scope: string;
      };

      const home = internal.home ?? os.homedir();
      const cwd = internal.cwd ?? process.cwd();
      const scope = (opts.scope === "project" ? "project" : "user") as "user" | "project";
      const installOpts: InstallOpts = { hasClaudeCli: internal.hasClaudeCli };

      // Surface selection
      const doMcp = opts.all ? true : !!opts.mcp;
      const doSkills = opts.all ? true : !!opts.skills;

      if (!doMcp && !doSkills) {
        process.stdout.write(
          "specify --mcp, --skills, or --all to select what to remove\n",
        );
        return;
      }

      // Determine which client ids were explicitly requested via per-client flags
      const requestedIds = new Set<string>();
      const anyPerClientFlag = Object.entries(CLIENT_FLAG_MAP).some(
        ([flagName]) => !!(opts as Record<string, unknown>)[flagName],
      );

      if (anyPerClientFlag) {
        for (const [flagName, clientId] of Object.entries(CLIENT_FLAG_MAP)) {
          if ((opts as Record<string, unknown>)[flagName]) {
            requestedIds.add(clientId);
          }
        }
      }

      // Helper: select clients from a registry based on --all / per-client flags
      function selectClients<T extends { id: string }>(registry: T[]): T[] {
        if (opts.all || !anyPerClientFlag) {
          // No per-client filter: use all clients in this registry
          return registry;
        }
        // Filter: only those whose id was explicitly requested
        return registry.filter((c) => requestedIds.has(c.id));
      }

      let anyFailed = false;

      // --- MCP surface ---
      if (doMcp) {
        const selectedMcpClients = selectClients(MCP_CLIENTS);
        for (const client of selectedMcpClients) {
          try {
            const result = removeMcp(client, scope, home, cwd, installOpts);
            if (result.removed) {
              process.stdout.write(`removed octen from ${client.label} (${quotePath(result.path)})\n`);
            } else {
              process.stdout.write(`octen not present in ${client.label}\n`);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            process.stderr.write(
              pc.red(`warning: failed to remove MCP from ${client.label}: ${msg}`) + "\n",
            );
            anyFailed = true;
          }
        }
      }

      // --- Skills surface ---
      if (doSkills) {
        // Claude Desktop shares Claude Code's ~/.claude/skills, so for the skills
        // surface treat --claude-desktop as --claude-code (consistent with configure-skills).
        const skillRequestedIds = new Set(requestedIds);
        if (skillRequestedIds.has("claude-desktop")) skillRequestedIds.add("claude-code");
        const selectedSkillClients =
          opts.all || !anyPerClientFlag
            ? SKILL_CLIENTS
            : SKILL_CLIENTS.filter((c) => skillRequestedIds.has(c.id));
        for (const client of selectedSkillClients) {
          try {
            const skillsDir = client.dirFor(scope, home, cwd);
            const removed = removeSkills(skillsDir);
            if (removed.length > 0) {
              process.stdout.write(
                `removed [${removed.join(", ")}] from ${client.label} (${quotePath(skillsDir)})\n`,
              );
            } else {
              process.stdout.write(`no octen skills in ${client.label}\n`);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            process.stderr.write(
              pc.red(`warning: failed to remove skills from ${client.label}: ${msg}`) + "\n",
            );
            anyFailed = true;
          }
        }
      }

      if (anyFailed) {
        process.exitCode = 1;
      }
    });
}
