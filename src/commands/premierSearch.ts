import type { Command } from "commander";
import { ENDPOINTS } from "../api/constants.js";
import { buildPremierSearchRequest, type PremierSearchOpts } from "../api/premierSearch.js";
import type { SearchResponse } from "../api/search.js";
import { chooseMode, emit } from "../output/render.js";
import { renderSearch } from "../output/pretty/search.js";
import { makeClient, parseCsvOpt, parseIntOpt } from "./utils.js";

/**
 * `/search-premier` takes the request body of `/search` and returns the same
 * response, so this is `search`'s flag set and `search`'s renderer. It is a
 * command of its own because it is a different endpoint, slower and billed at
 * its own rate — not something a flag on `search` should switch on quietly.
 */
export function registerPremierSearch(program: Command) {
  program.command("premier-search")
    .argument("<query...>", "search query")
    .description("Search the live web with deeper retrieval and reranking — slower than `search` and billed at its own rate, so reach for it when `search` falls short")
    .option("--result-type <t>", "standard|dynamic")
    .option("-n, --count <n>", "results 1-100", parseIntOpt("--count"))
    .option("--include-domains <list>", "comma list", parseCsvOpt("--include-domains"))
    .option("--exclude-domains <list>", "comma list", parseCsvOpt("--exclude-domains"))
    .option("--include-text <list>", "comma list", parseCsvOpt("--include-text"))
    .option("--exclude-text <list>", "comma list", parseCsvOpt("--exclude-text"))
    .option("--time-basis <b>", "auto|published|crawled").option("--time-range <r>", "day|week|month|year (or d|w|m|y)")
    .option("--start-time <when>", "YYYY-MM-DD or ISO datetime (e.g. 2024-01-01T00:00:00Z)")
    .option("--end-time <when>", "YYYY-MM-DD or ISO datetime (e.g. 2024-12-31T23:59:59Z)")
    .option("--format <f>", "text|markdown").option("--safesearch <s>", "off|strict")
    .option("--language <list>", "ISO 639-1 codes, comma-separated, e.g. en,ja", parseCsvOpt("--language"))
    .option("--highlight").option("--highlight-max-tokens <n>", "max tokens per highlight", parseIntOpt("--highlight-max-tokens"))
    .option("--full-content").option("--full-content-max-tokens <n>", "max tokens per result", parseIntOpt("--full-content-max-tokens"))
    .option("--images")
    .action(async (queryArg: string[], opts: PremierSearchOpts, command: Command) => {
      const g = command.optsWithGlobals();
      const client = makeClient(g);
      const req = buildPremierSearchRequest(queryArg.join(" "), opts);
      const res = await client.request<SearchResponse>(ENDPOINTS.searchPremier, req);
      emit(res, chooseMode(g, process.stdout.isTTY ?? false), renderSearch);
    });
}
