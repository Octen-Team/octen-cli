import type { Command } from "commander";
import { ENDPOINTS } from "../api/constants.js";
import {
  buildVideoSearchRequest,
  type VideoSearchOpts,
  type VideoSearchResponse,
} from "../api/mediaSearch.js";
import { chooseMode, emit } from "../output/render.js";
import { renderVideoSearch } from "../output/pretty/videoSearch.js";
import { makeClient, parseIntOpt } from "./utils.js";

export function registerVideoSearch(program: Command) {
  program
    .command("video-search")
    .argument("<query...>", "search query")
    .description(
      "In Beta. Contact us to request beta access. — Search the web for videos by text",
    )
    .option("-n, --count <n>", "results 1-10", parseIntOpt("--count"))
    .option("--time-range <r>", "day|week|month|year (or d|w|m|y)")
    .option("--start-time <when>", "YYYY-MM-DD or ISO datetime (e.g. 2024-01-01T00:00:00Z)")
    .option("--end-time <when>", "YYYY-MM-DD or ISO datetime (e.g. 2024-12-31T23:59:59Z)")
    .option("--safesearch <s>", "off|strict")
    .action(async (queryArg: string[] | string, opts: VideoSearchOpts, command: Command) => {
      const g = command.optsWithGlobals();
      const client = makeClient(g);
      const query = Array.isArray(queryArg) ? queryArg.join(" ") : queryArg;
      const req = buildVideoSearchRequest(query, opts);
      const res = await client.request<VideoSearchResponse>(ENDPOINTS.videoSearch, req);
      emit(res, chooseMode(g, process.stdout.isTTY ?? false), renderVideoSearch);
    });
}
