import type { Command } from "commander";
import { ENDPOINTS } from "../api/constants.js";
import { buildExtractRequest, type ExtractOpts, type ExtractResponse } from "../api/extract.js";
import { chooseMode, emit } from "../output/render.js";
import { renderExtract } from "../output/pretty/extract.js";
import { makeClient, parseIntOpt } from "./utils.js";

export function registerExtract(program: Command) {
  program
    .command("extract")
    .argument("<urls...>", "one or more URLs (1-20)")
    .description("Extract content from URLs")
    .option("--query <q>", "optional search query for relevance")
    .option("--max-age <sec>", "max cache age in seconds", parseIntOpt("--max-age"))
    .option("--format <f>", "markdown|text")
    .option("--fetch-timeout <sec>", "per-URL fetch timeout (1-60)", parseIntOpt("--fetch-timeout"))
    .option("--images", "include images")
    .option("--videos", "include videos")
    .option("--audio", "include audio")
    .option("--favicon", "include favicon")
    .option("--full", "print full page content untruncated (pretty mode)")
    .action(async (urls: string[], opts: ExtractOpts & { full?: boolean }, command: Command) => {
      const g = command.optsWithGlobals();
      const client = makeClient(g);
      const req = buildExtractRequest(urls, opts);
      const res = await client.request<ExtractResponse>(ENDPOINTS.extract, req);
      emit(res, chooseMode(g, process.stdout.isTTY ?? false), (d) => renderExtract(d, opts.full));
    });
}
