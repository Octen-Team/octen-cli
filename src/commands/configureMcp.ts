import os from "node:os";
import type { Command } from "commander";
import { MCP_CLIENTS } from "../mcp/clients.js";
import { installMcp, type InstallOpts } from "../mcp/install.js";
import { mcpStatus } from "../mcp/detect.js";
import { resolveApiKey } from "../config/resolve.js";

interface ConfigureMcpInternalOpts {
  /** Injected home dir (for testing); defaults to os.homedir() */
  home?: string;
  /** Injected cwd (for testing); defaults to process.cwd() */
  cwd?: string;
  /** Override claude CLI detection (for testing) */
  hasClaudeCli?: boolean;
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

      // INSTALL MODE
      const selected = opts.all
        ? MCP_CLIENTS
        : MCP_CLIENTS.filter((c) => {
            const flagName = clientFlagMap[c.id];
            return flagName ? Boolean((opts as Record<string, unknown>)[flagName]) : false;
          });

      for (const client of selected) {
        try {
          const result = installMcp(client, scope, entry, home, cwd, installOpts);
          if (result.method === "claude-cli") {
            process.stdout.write(`${client.label}: configured via claude CLI\n`);
          } else {
            process.stdout.write(`${client.label}: configured → ${result.path}\n`);
          }
        } catch (err) {
          throw err;
        }
      }

      if (keyMissing) {
        process.stderr.write(
          "warning: no API key found — set OCTEN_API_KEY in each client's environment\n",
        );
      }
    });
}
