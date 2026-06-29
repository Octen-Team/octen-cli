import type { Command } from "commander";
import { ENDPOINTS } from "../api/constants.js";
import {
  buildBroadSearchRequest,
  type BroadSearchOpts,
  type BroadSearchResponse,
} from "../api/search.js";
import { chooseMode, emit } from "../output/render.js";
import { renderBroadSearch } from "../output/pretty/broadSearch.js";
import { makeClient, parseIntOpt } from "./utils.js";

export function registerBroadSearch(program: Command) {
  program.command("broad-search")
    .alias("broad")
    .argument("<query...>", "search query")
    .description("Broad multi-angle web search — decomposes the query into sub-queries searched concurrently")
    .option("--max-queries <n>", "decompose into up to N sub-queries (1-30)", parseIntOpt("--max-queries"))
    .option("--topic <t>", "general|news")
    .option("-n, --count <n>", "results per sub-query 1-100", parseIntOpt("--count"))
    .option("--include-domains <list>", "comma list", (v) => v.split(","))
    .option("--exclude-domains <list>", "comma list", (v) => v.split(","))
    .option("--include-text <list>", "comma list", (v) => v.split(","))
    .option("--exclude-text <list>", "comma list", (v) => v.split(","))
    .option("--time-basis <b>", "auto|published|crawled").option("--time-range <r>", "day|week|month|year (or d|w|m|y)")
    .option("--start-time <when>", "YYYY-MM-DD or ISO datetime (e.g. 2024-01-01T00:00:00Z)")
    .option("--end-time <when>", "YYYY-MM-DD or ISO datetime (e.g. 2024-12-31T23:59:59Z)")
    .option("--format <f>", "text|markdown").option("--safesearch <s>", "off|strict")
    .option("--highlight").option("--highlight-max-tokens <n>", "max tokens per highlight", parseIntOpt("--highlight-max-tokens"))
    .option("--full-content").option("--full-content-max-tokens <n>", "max tokens per result", parseIntOpt("--full-content-max-tokens"))
    .option("--images").option("--videos")
    .action(async (queryArg: string[] | string, opts: BroadSearchOpts, command: Command) => {
      const g = command.optsWithGlobals();
      const client = makeClient(g);
      const query = Array.isArray(queryArg) ? queryArg.join(" ") : queryArg;
      const req = buildBroadSearchRequest(query, opts);
      const res = await client.request<BroadSearchResponse>(ENDPOINTS.broadSearch, req);
      emit(res, chooseMode(g, process.stdout.isTTY ?? false), renderBroadSearch);
    });
}
