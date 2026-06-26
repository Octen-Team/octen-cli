import os from "node:os";
import pc from "picocolors";
import type { Command } from "commander";
import { MCP_CLIENTS } from "../mcp/clients.js";
import { installMcp, type InstallOpts } from "../mcp/install.js";
import { mcpStatus } from "../mcp/detect.js";
import { resolveApiKey } from "../config/resolve.js";
import { isClientInstalled } from "../util/detectClient.js";
import { quotePath } from "../util/quotePath.js";

interface ConfigureMcpInternalOpts {
  /** Injected home dir (for testing); defaults to os.homedir() */
  home?: string;
  /** Injected cwd (for testing); defaults to process.cwd() */
  cwd?: string;
  /** Override claude CLI detection (for testing) */
  hasClaudeCli?: boolean;
  /** Override client-installed detection (for testing) */
  isInstalled?: (id: string) => boolean;
}

// Exported so tests can call with injected dirs
export function registerConfigureMcp(
  program: Command,
  internal: ConfigureMcpInternalOpts = {},
) {
  program
    .command("configure-mcp")
    .description("Configure the Octen MCP server in AI clients")
    .option("--all", "configure all supported clients")
    .option("--claude-code", "configure Claude Code")
    .option("--cursor", "configure Cursor")
    .option("--claude-desktop", "configure Claude Desktop")
    .option("--windsurf", "configure Windsurf")
    .option("--vscode", "configure VS Code")
    .option("--codex", "configure Codex")
    .option(
      "--scope <s>",
      "config scope: user | project (default: user)",
      "user",
    )
    .option("--pin <ver>", "pin octen-mcp to a specific version, e.g. 0.2.1")
    .option("--force", "configure even if the client is not detected")
    .action(async (_opts: Record<string, any>, command: Command) => {
      const g = command.optsWithGlobals();
      const opts = command.opts() as {
        all?: boolean;
        claudeCode?: boolean;
        cursor?: boolean;
        claudeDesktop?: boolean;
        windsurf?: boolean;
        vscode?: boolean;
        codex?: boolean;
        scope: string;
        pin?: string;
        force?: boolean;
      };

      const scope = (opts.scope === "project" ? "project" : "user") as
        | "user"
        | "project";
      const pin: string | undefined = opts.pin;

      // Resolve API key — tolerate missing
      let key: string;
      let keyMissing = false;
      try {
        key = resolveApiKey(g.apiKey, process.env);
      } catch {
        key = "${OCTEN_API_KEY}";
        keyMissing = true;
      }

      // Build the MCP server entry
      const entry = {
        command: "npx",
        args: ["-y", pin ? `octen-mcp@${pin}` : "octen-mcp"],
        env: { OCTEN_API_KEY: key },
      };

      // Determine the effective home/cwd
      const home = internal.home ?? os.homedir();
      const cwd = internal.cwd ?? process.cwd();
      const isInstalled =
        internal.isInstalled ?? ((id: string) => isClientInstalled(id, { home }));

      const installOpts: InstallOpts = { hasClaudeCli: internal.hasClaudeCli };

      // Determine selected clients
      const clientFlagMap: Record<string, string> = {
        "claude-code": "claudeCode",
        "claude-desktop": "claudeDesktop",
        cursor: "cursor",
        windsurf: "windsurf",
        vscode: "vscode",
        codex: "codex",
      };

      const anySelected =
        opts.all ||
        opts.claudeCode ||
        opts.cursor ||
        opts.claudeDesktop ||
        opts.windsurf ||
        opts.vscode ||
        opts.codex;

      if (!anySelected) {
        // STATUS MODE: print status for each client
        for (const client of MCP_CLIENTS) {
          const status = mcpStatus(client, scope, home, cwd);
          process.stdout.write(`${client.label}: ${status}\n`);
        }
        return;
      }

      // INSTALL MODE — determine which clients to act on, gated by detection.
      let selected: typeof MCP_CLIENTS;
      if (opts.all) {
        // Start from the full registry, then filter to installed ones.
        const skipped: string[] = [];
        selected = MCP_CLIENTS.filter((c) => {
          if (isInstalled(c.id)) return true;
          skipped.push(c.label);
          return false;
        });
        if (skipped.length > 0) {
          process.stdout.write(
            `skipped (not installed): ${skipped.join(", ")}\n`,
          );
        }
      } else {
        // Explicit per-client flags: warn + skip not-installed unless --force.
        const requested = MCP_CLIENTS.filter((c) => {
          const flagName = clientFlagMap[c.id];
          return flagName ? Boolean((opts as Record<string, unknown>)[flagName]) : false;
        });
        selected = requested.filter((c) => {
          if (opts.force || isInstalled(c.id)) return true;
          process.stderr.write(
            `warning: ${c.label} not detected — skipping (use --force to configure anyway)\n`,
          );
          return false;
        });
      }

      if (selected.length === 0) {
        process.stdout.write("no installed clients to configure\n");
        return;
      }

      let anyFailed = false;
      for (const client of selected) {
        try {
          const result = installMcp(client, scope, entry, home, cwd, installOpts);
          if (result.method === "claude-cli") {
            process.stdout.write(`${client.label}: configured via claude CLI\n`);
          } else {
            process.stdout.write(`${client.label}: configured → ${quotePath(result.path)}\n`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(pc.red(`error configuring ${client.label}: ${msg}`) + "\n");
          anyFailed = true;
        }
      }

      if (anyFailed) {
        process.exitCode = 1;
      }

      if (keyMissing) {
        process.stderr.write(
          "warning: no API key found — set OCTEN_API_KEY in each client's environment\n",
        );
      }
    });
}
