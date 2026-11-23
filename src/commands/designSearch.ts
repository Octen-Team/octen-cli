import type { Command } from "commander";
import { ENDPOINTS } from "../api/constants.js";
import {
  buildDesignSearchRequest,
  type DesignSearchOpts,
  type DesignSearchResponse,
} from "../api/designSearch.js";
import { chooseMode, emit } from "../output/render.js";
import { renderDesignSearch } from "../output/pretty/designSearch.js";
import { makeClient, parseCsvOpt, parseIntOpt } from "./utils.js";

export function registerDesignSearch(program: Command) {
  program.command("design")
    .argument("[query...]", "what to find, e.g. 'saas pricing page' (optional with --group)")
    .description("Real web pages, page sections, app screens and slides as design references — each a screenshot with its design values and, for page sections, the HTML. Web results on the same query come back alongside")
    .option("-n, --count <n>", "design references to return, 1-100", parseIntOpt("--count"))
    .option("--group <id>", "every image of one page or deck, in order — takes a result's group_id; set -n to the group's total")
    .option("--no-design-facts", "leave out the design values")
    .option("--no-snippet", "leave out the code")
    .option("--snippet-max-tokens <n>", "max tokens of code per result, 100-100000", parseIntOpt("--snippet-max-tokens"))
    .option("--no-images", "web results only")
    .option("--no-web", "design references only")
    .option("--web-count <n>", "web results, 1-100", parseIntOpt("--web-count"))
    .option("--include-domains <list>", "web results only: comma list", parseCsvOpt("--include-domains"))
    .option("--exclude-domains <list>", "web results only: comma list", parseCsvOpt("--exclude-domains"))
    .option("--language <list>", "web results only: ISO 639-1 codes, comma-separated, e.g. en,ja", parseCsvOpt("--language"))
    .option("--time-basis <b>", "web results only: auto|published|crawled")
    .option("--time-range <r>", "web results only: day|week|month|year (or d|w|m|y)")
    .option("--start-time <when>", "web results only: YYYY-MM-DD or ISO datetime")
    .option("--end-time <when>", "web results only: YYYY-MM-DD or ISO datetime")
    .option("--highlight", "web results only")
    .option("--highlight-max-tokens <n>", "web results only: max tokens per highlight", parseIntOpt("--highlight-max-tokens"))
    .option("--full-content", "web results only")
    .option("--full-content-max-tokens <n>", "web results only: max tokens per result (needs --full-content)", parseIntOpt("--full-content-max-tokens"))
    .action(async (queryArg: string[] | undefined, opts: Record<string, any>, command: Command) => {
      const g = command.optsWithGlobals();
      const client = makeClient(g);
      // Picked field by field, not spread: commander gives every `--no-x`
      // option a default of `true`, and the builder wants to know only whether
      // it was switched off.
      const o: DesignSearchOpts = {
        count: opts.count,
        group: opts.group,
        noImages: opts.images === false,
        noDesignFacts: opts.designFacts === false,
        noSnippet: opts.snippet === false,
        snippetMaxTokens: opts.snippetMaxTokens,
        noWeb: opts.web === false,
        webCount: opts.webCount,
        includeDomains: opts.includeDomains,
        excludeDomains: opts.excludeDomains,
        language: opts.language,
        timeBasis: opts.timeBasis,
        timeRange: opts.timeRange,
        startTime: opts.startTime,
        endTime: opts.endTime,
        highlight: opts.highlight,
        highlightMaxTokens: opts.highlightMaxTokens,
        fullContent: opts.fullContent,
        fullContentMaxTokens: opts.fullContentMaxTokens,
      };
      const req = buildDesignSearchRequest((queryArg ?? []).join(" "), o);
      const res = await client.request<DesignSearchResponse>(ENDPOINTS.designSearch, req);
      // The renderer is told when this was a lookup: it prints different hints
      // for a group that was asked for than for one a search happened to hit.
      const group = (req.images as { group_id?: string } | undefined)?.group_id;
      emit(res, chooseMode(g, process.stdout.isTTY ?? false), (d) => renderDesignSearch(d, { group }));
    });
}
