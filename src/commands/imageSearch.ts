import type { Command } from "commander";
import { ENDPOINTS } from "../api/constants.js";
import {
  buildImageSearchRequest,
  type ImageSearchOpts,
  type ImageSearchResponse,
} from "../api/mediaSearch.js";
import { chooseMode, emit } from "../output/render.js";
import { renderImageSearch } from "../output/pretty/imageSearch.js";
import { makeClient, parseCsvOpt, parseIntOpt } from "./utils.js";

export function registerImageSearch(program: Command) {
  program
    .command("image-search")
    .argument("[query...]", "search query (optional if --image is given)")
    .description(
      "Search the web for images by text or by image (one or the other)",
    )
    .option("--image <url|path>", "image input: public URL or local file path")
    .option("-n, --count <n>", "results 1-10", parseIntOpt("--count"))
    .option("--include-domains <list>", "comma list", parseCsvOpt("--include-domains"))
    .option("--exclude-domains <list>", "comma list", parseCsvOpt("--exclude-domains"))
    .option("--safesearch <s>", "off|strict")
    .action(async (queryArg: string[], opts: Record<string, any>, command: Command) => {
      const g = command.optsWithGlobals();
      const client = makeClient(g);
      const query = Array.isArray(queryArg) ? queryArg.join(" ") : (queryArg ?? "");
      const imageOpts: ImageSearchOpts = {
        image: opts.image,
        count: opts.count,
        includeDomains: opts.includeDomains,
        excludeDomains: opts.excludeDomains,
        safesearch: opts.safesearch,
      };
      const req = buildImageSearchRequest(query, imageOpts);
      const res = await client.request<ImageSearchResponse>(ENDPOINTS.imageSearch, req);
      emit(res, chooseMode(g, process.stdout.isTTY ?? false), renderImageSearch);
    });
}
