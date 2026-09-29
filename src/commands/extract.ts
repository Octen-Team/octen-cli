import type { Command } from "commander";
import { ENDPOINTS } from "../api/constants.js";
import {
  buildExtractRequest,
  extractClientTimeoutMs,
  type ExtractEnvelope,
  type ExtractOpts,
} from "../api/extract.js";
import { chooseMode, emit } from "../output/render.js";
import { renderExtract } from "../output/pretty/extract.js";
import { makeClient, parseIntOpt, parseLinkScopeOpt } from "./utils.js";

export function registerExtract(program: Command) {
  program
    .command("extract")
    .argument("<urls...>", "one or more URLs (1-20)")
    .description("Extract content from URLs")
    .option("--query <q>", "optional search query for relevance")
    .option("--max-age <sec>", "max cache age in seconds", parseIntOpt("--max-age"))
    .option("--format <f>", "markdown|text")
    .option("--fetch-timeout <sec>", "per-URL fetch timeout (1-60)", parseIntOpt("--fetch-timeout"))
    .option("--images", "include images (also returns cover_image when present)")
    .option("--videos", "include videos")
    .option("--audio", "include audio")
    .option("--mode <m>", "standard (default, fast/cheap) | advanced (hard sites, 2.5x) | auto (mixed batch)")
    .option("--links [scope]", "include page links; scope prefer_internal (default) | prefer_external", parseLinkScopeOpt("--links"))
    .option("--max-links <n>", "max links per page (1-1000, default 200); implies --links", parseIntOpt("--max-links"))
    .option("--full", "print full page content, links and media untruncated (pretty mode)")
    .action(async (urls: string[], opts: ExtractOpts & { full?: boolean }, command: Command) => {
      const g = command.optsWithGlobals();
      const client = makeClient(g);
      const req = buildExtractRequest(urls, opts);
      // Per-call ceiling derived from the per-URL budget; the client default is too tight.
      const res = await client.request<ExtractEnvelope>(
        ENDPOINTS.extract,
        req,
        extractClientTimeoutMs(opts.fetchTimeout),
      );
      emit(res, chooseMode(g, process.stdout.isTTY ?? false), (d) => renderExtract(d, opts.full, opts.mode));
    });
}
