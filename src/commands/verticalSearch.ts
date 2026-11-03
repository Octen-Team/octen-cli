import type { Command } from "commander";
import { ENDPOINTS } from "../api/constants.js";
import {
  buildBusinessSearchRequest,
  buildNewsSearchRequest,
  buildPulseSearchRequest,
  type BusinessSearchOpts,
  type NewsSearchOpts,
  type PulseSearchOpts,
} from "../api/verticalSearch.js";
import { chooseMode, emit } from "../output/render.js";
import { renderBusinessSearch } from "../output/pretty/businessSearch.js";
import { renderNewsSearch } from "../output/pretty/newsSearch.js";
import { renderPulseSearch } from "../output/pretty/pulseSearch.js";
import { makeClient, parseCsvOpt, parseIntOpt } from "./utils.js";

/**
 * The retrieval options news and business share. Deliberately not `search`'s
 * full set: the API accepts the extras and ignores them, so offering them here
 * would hand back results that silently do not reflect the flags given.
 */
function addSharedOptions(cmd: Command): Command {
  return cmd
    .option("-n, --count <n>", "results 1-100", parseIntOpt("--count"))
    .option("--include-domains <list>", "comma list", parseCsvOpt("--include-domains"))
    .option("--exclude-domains <list>", "comma list", parseCsvOpt("--exclude-domains"))
    .option("--language <list>", "ISO 639-1 codes, comma-separated, e.g. en,ja", parseCsvOpt("--language"))
    .option("--time-basis <b>", "auto|published|crawled")
    .option("--time-range <r>", "day|week|month|year (or d|w|m|y)")
    .option("--start-time <when>", "YYYY-MM-DD or ISO datetime")
    .option("--end-time <when>", "YYYY-MM-DD or ISO datetime")
    .option("--highlight")
    .option("--highlight-max-tokens <n>", "max tokens per highlight", parseIntOpt("--highlight-max-tokens"))
    .option("--full-content")
    .option("--full-content-max-tokens <n>", "max tokens per result", parseIntOpt("--full-content-max-tokens"));
}

export function registerNewsSearch(program: Command) {
  addSharedOptions(
    program.command("news")
      .argument("<query...>", "what is being reported")
      .description("Recent news, returned as ranked articles and as storylines"),
  )
    .option("--no-subjects", "skip the storyline clustering")
    .option("--subjects-count <n>", "storylines to return, 1-5", parseIntOpt("--subjects-count"))
    .option("--max-sub-news <n>", "supporting articles per storyline, 1-20", parseIntOpt("--max-sub-news"))
    .action(async (queryArg: string[], opts: Record<string, any>, command: Command) => {
      const g = command.optsWithGlobals();
      const client = makeClient(g);
      // commander turns `--no-subjects` into `subjects: false`; the builder
      // wants to know only whether it was switched off.
      const o: NewsSearchOpts = { ...opts, noSubjects: opts.subjects === false };
      const req = buildNewsSearchRequest(queryArg.join(" "), o);
      const res = await client.request(ENDPOINTS.newsSearch, req);
      emit(res, chooseMode(g, process.stdout.isTTY ?? false), renderNewsSearch);
    });
}

export function registerBusinessSearch(program: Command) {
  addSharedOptions(
    program.command("business")
      .argument("<query...>", "a company, or a person in a business context")
      .description("Companies and people as structured cards, alongside ranked sources"),
  )
    .option("--no-entities", "skip the entity cards and return sources only")
    .option("--entities-count <n>", "entities to profile, 1-20", parseIntOpt("--entities-count"))
    .option("--max-activities <n>", "activities per entity, 1-20", parseIntOpt("--max-activities"))
    .option("--max-entity-news <n>", "news items per entity, 1-20", parseIntOpt("--max-entity-news"))
    .action(async (queryArg: string[], opts: Record<string, any>, command: Command) => {
      const g = command.optsWithGlobals();
      const client = makeClient(g);
      const o: BusinessSearchOpts = { ...opts, noEntities: opts.entities === false };
      const req = buildBusinessSearchRequest(queryArg.join(" "), o);
      const res = await client.request(ENDPOINTS.businessSearch, req);
      emit(res, chooseMode(g, process.stdout.isTTY ?? false), renderBusinessSearch);
    });
}

export function registerPulseSearch(program: Command) {
  program.command("pulse")
    .argument("<query...>", "what to find the destination for, e.g. 'uv docs'")
    .description("The URL a query most likely means, in about 10ms")
    .option("--mode <m>", "lite|standard — standard adds highlights and content")
    .option("-n, --count <n>", "results 1-10", parseIntOpt("--count"))
    .option("--safesearch <s>", "off|strict")
    .option("--images", "return image URLs per result (standard mode only)")
    .option("--highlight")
    .option("--highlight-max-tokens <n>", "max tokens per highlight", parseIntOpt("--highlight-max-tokens"))
    .option("--full-content")
    .option("--full-content-max-tokens <n>", "max tokens per result", parseIntOpt("--full-content-max-tokens"))
    .action(async (queryArg: string[], opts: PulseSearchOpts, command: Command) => {
      const g = command.optsWithGlobals();
      const client = makeClient(g);
      const req = buildPulseSearchRequest(queryArg.join(" "), opts);
      const res = await client.request(ENDPOINTS.pulseSearch, req);
      emit(res, chooseMode(g, process.stdout.isTTY ?? false), renderPulseSearch);
    });
}
