import type { Command } from "commander";
import { ENDPOINTS } from "../api/constants.js";
import {
  buildImageSearchRequest,
  type ImageSearchOpts,
  type ImageSearchResponse,
} from "../api/mediaSearch.js";
import { chooseMode, emit } from "../output/render.js";
import { renderImageSearch } from "../output/pretty/imageSearch.js";
import { makeClient, parseIntOpt } from "./utils.js";

export function registerImageSearch(program: Command) {
  program
    .command("image-search")
    .argument("[query...]", "search query (optional if --image is given)")
    .description(
      "In Beta. Contact us to request beta access. — Search the web for images by text and/or image. Use --topic design for UI design references (returns a style summary and html_snippet per result)",
    )
    .option("--image <url|path>", "image input: public URL or local file path")
    .option("--topic <t>", "general|design")
    .option("-n, --count <n>", "results 1-10", parseIntOpt("--count"))
    .option("--include-domains <list>", "comma list", (v) => v.split(","))
    .option("--exclude-domains <list>", "comma list", (v) => v.split(","))
    .option("--time-range <r>", "day|week|month|year (or d|w|m|y)")
    .option("--start-time <when>", "YYYY-MM-DD or ISO datetime (e.g. 2024-01-01T00:00:00Z)")
    .option("--end-time <when>", "YYYY-MM-DD or ISO datetime (e.g. 2024-12-31T23:59:59Z)")
    .option("--safesearch <s>", "off|strict")
    .option("--html-snippet", "include HTML snippet for each result")
    .option("--html-snippet-max-tokens <n>", "max tokens per HTML snippet", parseIntOpt("--html-snippet-max-tokens"))
    .action(async (queryArg: string[], opts: Record<string, any>, command: Command) => {
      const g = command.optsWithGlobals();
      const client = makeClient(g);
      const query = Array.isArray(queryArg) ? queryArg.join(" ") : (queryArg ?? "");
      const imageOpts: ImageSearchOpts = {
        image: opts.image,
        topic: opts.topic,
        count: opts.count,
        includeDomains: opts.includeDomains,
        excludeDomains: opts.excludeDomains,
        timeRange: opts.timeRange,
        startTime: opts.startTime,
        endTime: opts.endTime,
        safesearch: opts.safesearch,
        htmlSnippet: opts.htmlSnippet,
        htmlSnippetMaxTokens: opts.htmlSnippetMaxTokens,
      };
      const req = buildImageSearchRequest(query, imageOpts);
      const res = await client.request<ImageSearchResponse>(ENDPOINTS.imageSearch, req);
      emit(res, chooseMode(g, process.stdout.isTTY ?? false), renderImageSearch);
    });
}
