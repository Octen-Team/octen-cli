#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pc from "picocolors";
import { exitCodeFor } from "./api/errors.js";

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));

const program = new Command();
program
  .name("octen")
  .description("Octen CLI — search, extract, chat, embeddings, and MCP/Skills setup")
  .version(pkg.version);

for (const [name, desc] of [
  ["search", "Search the live web"],
  ["news", "News-focused web search"],
  ["fetch", "Extract content from URLs"],
  ["chat", "Chat completion"],
  ["embed", "Create text embeddings"],
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

program.parseAsync().catch((err) => {
  process.stderr.write(pc.red(`error: ${(err as Error).message}\n`));
  process.exit(exitCodeFor(err));
});
