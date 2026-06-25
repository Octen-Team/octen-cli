#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pc from "picocolors";
import { exitCodeFor } from "./api/errors.js";
import { registerSearch } from "./commands/search.js";
import { registerFetch } from "./commands/fetch.js";
import { registerChat } from "./commands/chat.js";
import { registerEmbed } from "./commands/embed.js";

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

for (const [name, desc] of [
  ["vl-embed", "Create multimodal embeddings"],
  ["configure-mcp", "Configure the Octen MCP server in AI clients"],
  ["configure-skills", "Install Octen Agent Skills into AI clients"],
  ["reset", "Remove Octen MCP/skills from AI clients"],
] as const) {
  program.command(name).description(desc).action(() => {
    console.error(`'${name}' not yet implemented`);
    process.exit(1);
  });
}

registerSearch(program);
registerSearch(program, "news");
registerFetch(program);
registerChat(program);
registerEmbed(program);

program.parseAsync().catch((err) => {
  process.stderr.write(pc.red(`error: ${(err as Error).message}\n`));
  process.exit(exitCodeFor(err));
});
