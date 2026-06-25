import type { Command } from "commander";
import { OctenClient } from "../api/client.js";
import { ENDPOINTS } from "../api/constants.js";
import { buildSearchRequest, type SearchOpts } from "../api/search.js";
import { resolveApiKey, resolveBaseUrl } from "../config/resolve.js";
import { chooseMode, emit } from "../output/render.js";
import { renderSearch } from "../output/pretty/search.js";

export function registerSearch(program: Command, fixedTopic?: "news") {
  const cmd = program.command(fixedTopic ? "news" : "search")
    .argument("<query>", "search query")
    .description(fixedTopic ? "News-focused web search" : "Search the live web")
    .option("-n, --count <n>", "results 1-100", (v) => parseInt(v, 10))
    .option("--include-domains <list>", "comma list", (v) => v.split(","))
    .option("--exclude-domains <list>", "comma list", (v) => v.split(","))
    .option("--include-text <list>", "comma list", (v) => v.split(","))
    .option("--exclude-text <list>", "comma list", (v) => v.split(","))
    .option("--time-basis <b>").option("--time-range <r>")
    .option("--start-time <iso>").option("--end-time <iso>")
    .option("--format <f>", "text|markdown").option("--safesearch <s>", "off|strict")
    .option("--highlight").option("--highlight-max-tokens <n>", "", (v) => parseInt(v, 10))
    .option("--full-content").option("--full-content-max-tokens <n>", "", (v) => parseInt(v, 10))
    .option("--images").option("--videos");
  if (!fixedTopic) cmd.option("--topic <t>", "general|news");

  cmd.action(async (query: string, opts: any, command: Command) => {
    const g = command.optsWithGlobals();
    const apiKey = resolveApiKey(g.apiKey, process.env);
    const client = new OctenClient({ apiKey, baseUrl: resolveBaseUrl(g.baseUrl, process.env) });
    const searchOpts: SearchOpts = { ...opts, topic: fixedTopic ?? opts.topic };
    const req = buildSearchRequest(query, searchOpts);
    const res = await client.request(ENDPOINTS.search, req);
    emit(res, chooseMode(g, process.stdout.isTTY ?? false), renderSearch);
  });
}
