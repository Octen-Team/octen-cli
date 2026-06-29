#!/usr/bin/env node
import "./util/preflightColor.js";
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pc from "picocolors";
import { exitCodeFor } from "./api/errors.js";
import { registerSearch } from "./commands/search.js";
import { registerBroadSearch } from "./commands/broadSearch.js";
import { registerExtract } from "./commands/extract.js";
import { registerChat } from "./commands/chat.js";
import { registerEmbed } from "./commands/embed.js";
import { registerVlEmbed } from "./commands/vlEmbed.js";
import { registerImageSearch } from "./commands/imageSearch.js";
import { registerVideoSearch } from "./commands/videoSearch.js";
import { registerConfigureMcp } from "./commands/configureMcp.js";
import { registerConfigureSkills } from "./commands/configureSkills.js";
import { registerReset } from "./commands/reset.js";
import { registerCompletion } from "./commands/completion.js";

// Injected at build time for standalone binaries (bun --compile --define),
// which have no package.json on disk to read at runtime.
declare const __OCTEN_VERSION__: string | undefined;

function resolveVersion(): string {
  if (typeof __OCTEN_VERSION__ !== "undefined") return __OCTEN_VERSION__;
  const pkg = JSON.parse(
    readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
  );
  return pkg.version as string;
}

const program = new Command();
program
  .name("octen")
  .description("Octen CLI — search, extract, chat, embeddings, and MCP/Skills setup")
  .version(resolveVersion())
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
registerBroadSearch(program);
registerExtract(program);
registerChat(program);
registerEmbed(program);
registerVlEmbed(program);
registerImageSearch(program);
registerVideoSearch(program);

// Register LAST so introspection sees every command and its flags.
registerCompletion(program);

program.parseAsync().catch((err) => {
  process.stderr.write(pc.red(`error: ${(err as Error).message}\n`));
  process.exit(exitCodeFor(err));
});
