#!/usr/bin/env node
import "./util/preflightColor.js";
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pc from "picocolors";
import { exitCodeFor } from "./api/errors.js";
import { registerSearch } from "./commands/search.js";
import { registerFetch } from "./commands/fetch.js";
import { registerChat } from "./commands/chat.js";
import { registerEmbed } from "./commands/embed.js";
import { registerVlEmbed } from "./commands/vlEmbed.js";
import { registerConfigureMcp } from "./commands/configureMcp.js";
import { registerConfigureSkills } from "./commands/configureSkills.js";
import { registerReset } from "./commands/reset.js";
import { registerCompletion } from "./commands/completion.js";

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));

const program = new Command();
program
  .name("octen")
  .description("Octen CLI — search, extract, chat, embeddings, and MCP/Skills setup")
  .version(pkg.version)
  .option("--api-key <key>", "Octen API key")
  .option("--base-url <url>", "API base URL")
  .option("--json", "raw JSON output")
  .option("--pretty", "human-readable output")
  .option("--no-color", "disable color");

registerReset(program);
registerConfigureMcp(program);
registerConfigureSkills(program);

registerSearch(program);
registerSearch(program, "news");
registerFetch(program);
registerChat(program);
registerEmbed(program);
registerVlEmbed(program);

// Register LAST so introspection sees every command and its flags.
registerCompletion(program);

program.parseAsync().catch((err) => {
  process.stderr.write(pc.red(`error: ${(err as Error).message}\n`));
  process.exit(exitCodeFor(err));
});
