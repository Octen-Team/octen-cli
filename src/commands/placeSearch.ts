import type { Command } from "commander";
import { ENDPOINTS } from "../api/constants.js";
import {
  buildPlaceSearchRequest,
  type PlaceSearchOpts,
  type PlaceSearchResponse,
} from "../api/placeSearch.js";
import { chooseMode, emit } from "../output/render.js";
import { renderPlaceSearch } from "../output/pretty/placeSearch.js";
import { makeClient, parseIntOpt } from "./utils.js";

/** commander hands numeric options back as strings; coordinates need floats. */
function parseFloatOpt(flag: string) {
  return (raw: string): number => {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${flag} must be a number`);
    return n;
  };
}

export function registerPlaceSearch(program: Command) {
  program.command("place")
    .argument("<query...>", "what to find, e.g. 'coffee shop'")
    .description("Real-world places with address, hours, rating and distance")
    .option("--latitude <n>", "WGS84 latitude to search around", parseFloatOpt("--latitude"))
    .option("--longitude <n>", "WGS84 longitude to search around", parseFloatOpt("--longitude"))
    .option("--radius <m>", "cap distance from the point, in metres (1-50000)", parseIntOpt("--radius"))
    .option("--city <name>", "approximate location, when coordinates are unknown")
    .option("--region <name>", "approximate location: region or state")
    .option("--country <code>", "approximate location: country")
    .option("-n, --count <n>", "places to return, 1-20", parseIntOpt("--count"))
    .option("--max-reviews <n>", "review excerpts per place, 0-5 (off by default)", parseIntOpt("--max-reviews"))
    .option("--web", "also return web pages about these places")
    .option("--web-count <n>", "web results, 1-100 (needs --web)", parseIntOpt("--web-count"))
    .action(async (queryArg: string[], opts: PlaceSearchOpts, command: Command) => {
      const g = command.optsWithGlobals();
      const client = makeClient(g);
      const req = buildPlaceSearchRequest(queryArg.join(" "), opts);
      const res = await client.request<PlaceSearchResponse>(ENDPOINTS.placeSearch, req);
      emit(res, chooseMode(g, process.stdout.isTTY ?? false), renderPlaceSearch);
    });
}
