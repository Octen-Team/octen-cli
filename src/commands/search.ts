import type { Command } from "commander";
import { ENDPOINTS } from "../api/constants.js";
import { buildSearchRequest, type SearchOpts } from "../api/search.js";
import { chooseMode, emit } from "../output/render.js";
import { renderSearch } from "../output/pretty/search.js";
import { makeClient, parseIntOpt } from "./utils.js";

export function registerSearch(program: Command, fixedTopic?: "news") {
  const cmd = program.command(fixedTopic ?? "search")
    .argument("<query>", "search query")
    .description(fixedTopic ? "News-focused web search" : "Search the live web")
    .option("-n, --count <n>", "results 1-100", parseIntOpt("--count"))
    .option("--include-domains <list>", "comma list", (v) => v.split(","))
    .option("--exclude-domains <list>", "comma list", (v) => v.split(","))
    .option("--include-text <list>", "comma list", (v) => v.split(","))
    .option("--exclude-text <list>", "comma list", (v) => v.split(","))
    .option("--time-basis <b>").option("--time-range <r>")
    .option("--start-time <iso>").option("--end-time <iso>")
    .option("--format <f>", "text|markdown").option("--safesearch <s>", "off|strict")
    .option("--highlight").option("--highlight-max-tokens <n>", "max tokens per highlight", parseIntOpt("--highlight-max-tokens"))
    .option("--full-content").option("--full-content-max-tokens <n>", "max tokens per result", parseIntOpt("--full-content-max-tokens"))
    .option("--images").option("--videos");
  if (!fixedTopic) cmd.option("--topic <t>", "general|news");

  cmd.action(async (query: string, opts: SearchOpts, command: Command) => {
    const g = command.optsWithGlobals();
    const client = makeClient(g);
    const searchOpts: SearchOpts = { ...opts, topic: fixedTopic ?? opts.topic };
    const req = buildSearchRequest(query, searchOpts);
    const res = await client.request(ENDPOINTS.search, req);
    emit(res, chooseMode(g, process.stdout.isTTY ?? false), renderSearch);
  });
}
