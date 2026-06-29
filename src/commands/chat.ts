import { createInterface } from "node:readline";
import type { Command } from "commander";
import { ENDPOINTS } from "../api/constants.js";
import {
  buildChatRequest,
  type ChatMessage,
  type ChatOpts,
  type ChatCompletion,
  type StreamEvent,
  type ReasoningEffort,
  type Verbosity,
  type SearchTimeBasis,
  type SearchSafesearch,
  type SearchFormat,
} from "../api/chat.js";
import pc from "picocolors";
import { parseSSE } from "../api/sse.js";
import { OctenValidationError } from "../api/errors.js";
import { chooseMode, emit } from "../output/render.js";
import { renderChat } from "../output/pretty/chat.js";
import { makeClient, parseIntOpt, parseFloatOpt } from "./utils.js";

const splitList = (v: string): string[] => v.split(",").map((s) => s.trim()).filter(Boolean);

export interface ReplStreams {
  input: NodeJS.ReadableStream;
  /** prompts, errors and notices (stderr) */
  promptOut: NodeJS.WritableStream;
  /** assistant replies (stdout) */
  replyOut: NodeJS.WritableStream;
}

/**
 * Drive an interactive chat REPL until the input closes (EOF, /exit, /quit).
 * `send` performs one round-trip given the running history and returns the reply.
 *
 * Every readline operation is guarded by a `closed` flag: piped/scripted input
 * can hit EOF (and close the interface) while a request is still in flight, and
 * resuming/prompting a closed readline throws ERR_USE_AFTER_CLOSE.
 */
export async function runChatRepl(
  streams: ReplStreams,
  send: (history: ChatMessage[]) => Promise<string>,
  system?: string,
): Promise<void> {
  const history: ChatMessage[] = [];
  if (system) history.push({ role: "system", content: system });

  const rl = createInterface({ input: streams.input, output: streams.promptOut, prompt: "> " });
  let closed = false;
  const prompt = () => {
    if (!closed) rl.prompt();
  };

  await new Promise<void>((resolve) => {
    rl.on("close", () => {
      closed = true;
      resolve();
    });

    rl.on("line", async (line: string) => {
      const trimmed = line.trim();
      if (trimmed === "/exit" || trimmed === "/quit") {
        rl.close();
        return;
      }
      if (trimmed === "/reset") {
        history.length = 0;
        if (system) history.push({ role: "system", content: system });
        streams.promptOut.write("(conversation reset)\n");
        prompt();
        return;
      }
      if (!trimmed) {
        prompt();
        return;
      }

      history.push({ role: "user", content: trimmed });
      rl.pause();
      try {
        const reply = await send(history);
        history.push({ role: "assistant", content: reply });
        streams.replyOut.write(reply + "\n");
      } catch (err) {
        streams.promptOut.write(`error: ${(err as Error).message}\n`);
      } finally {
        if (!closed) {
          rl.resume();
          rl.prompt();
        }
      }
    });

    rl.prompt();
  });
}

export function registerChat(program: Command) {
  program
    .command("chat")
    .argument("[prompt]", "prompt (or read stdin / use -i)")
    .description("Chat completion")
    .option("-m, --model <id>", "model ID, e.g. anthropic/claude-haiku-4.5 (required unless OCTEN_CHAT_MODEL is set)")
    .option("--system <s>", "system message")
    .option("--cache-system", "send the system message as a cache_control ephemeral block")
    // ── Web search (octen_search tool) ──────────────────────────────────────
    .option("--search", "enable web search via the built-in octen_search tool")
    .option("--search-max-searches <n>", "octen_search: max searches (default 5)", parseIntOpt("--search-max-searches"))
    .option("--search-count <n>", "octen_search: results per search (1-100)", parseIntOpt("--search-count"))
    .option("--search-include-domains <list>", "octen_search: comma-separated domains to include", splitList)
    .option("--search-exclude-domains <list>", "octen_search: comma-separated domains to exclude", splitList)
    .option("--search-time-basis <b>", "octen_search: auto|published|crawled")
    .option("--search-start-time <when>", "octen_search: start time filter")
    .option("--search-end-time <when>", "octen_search: end time filter")
    .option("--search-format <f>", "octen_search: markdown|text")
    .option("--search-safesearch <s>", "octen_search: off|strict")
    .option("--search-full-content", "octen_search: include full page content")
    .option("--search-full-content-max-tokens <n>", "octen_search: max tokens for full content", parseIntOpt("--search-full-content-max-tokens"))
    .option("--search-highlight-max-tokens <n>", "octen_search: max tokens for highlights", parseIntOpt("--search-highlight-max-tokens"))
    // ── Sampling ────────────────────────────────────────────────────────────
    .option("--temperature <n>", "sampling temperature", parseFloatOpt("--temperature"))
    .option("--top-p <n>", "nucleus sampling top-p", parseFloatOpt("--top-p"))
    .option("--top-k <n>", "top-k sampling", parseIntOpt("--top-k"))
    .option("--min-p <n>", "min-p sampling", parseFloatOpt("--min-p"))
    .option("--top-a <n>", "top-a sampling", parseFloatOpt("--top-a"))
    .option("--repetition-penalty <n>", "repetition penalty", parseFloatOpt("--repetition-penalty"))
    .option("--frequency-penalty <n>", "frequency penalty", parseFloatOpt("--frequency-penalty"))
    .option("--presence-penalty <n>", "presence penalty", parseFloatOpt("--presence-penalty"))
    .option("--max-tokens <n>", "max output tokens", parseIntOpt("--max-tokens"))
    .option("--max-completion-tokens <n>", "max completion tokens (includes reasoning tokens)", parseIntOpt("--max-completion-tokens"))
    .option("--verbosity <v>", "low|medium|high")
    .option("--reasoning-effort <e>", "xhigh|high|medium|low|minimal|none")
    .option("--reasoning-max-tokens <n>", "max reasoning tokens", parseIntOpt("--reasoning-max-tokens"))
    .option("--stop <list>", "comma-separated stop sequences", (v) => v.split(","))
    .option("--seed <n>", "random seed", parseIntOpt("--seed"))
    .option("--no-stream", "disable streaming (use request/response)")
    .option("-i, --interactive", "REPL mode")
    .action(async (promptArg: string | undefined, opts: any, command: Command) => {
      const g = command.optsWithGlobals();
      const client = makeClient(g);
      const mode = chooseMode(g, process.stdout.isTTY ?? false);

      const model: string | undefined = opts.model ?? process.env.OCTEN_CHAT_MODEL;

      const chatOpts: ChatOpts = {
        search: {
          enabled: Boolean(opts.search),
          maxSearches: opts.searchMaxSearches,
          count: opts.searchCount,
          includeDomains: opts.searchIncludeDomains,
          excludeDomains: opts.searchExcludeDomains,
          timeBasis: opts.searchTimeBasis as SearchTimeBasis | undefined,
          startTime: opts.searchStartTime,
          endTime: opts.searchEndTime,
          format: opts.searchFormat as SearchFormat | undefined,
          safesearch: opts.searchSafesearch as SearchSafesearch | undefined,
          fullContent: Boolean(opts.searchFullContent),
          fullContentMaxTokens: opts.searchFullContentMaxTokens,
          highlightMaxTokens: opts.searchHighlightMaxTokens,
        },
        maxTokens: opts.maxTokens,
        maxCompletionTokens: opts.maxCompletionTokens,
        temperature: opts.temperature,
        topP: opts.topP,
        topK: opts.topK,
        minP: opts.minP,
        topA: opts.topA,
        repetitionPenalty: opts.repetitionPenalty,
        frequencyPenalty: opts.frequencyPenalty,
        presencePenalty: opts.presencePenalty,
        stop: opts.stop,
        seed: opts.seed,
        verbosity: opts.verbosity as Verbosity | undefined,
        reasoningEffort: opts.reasoningEffort as ReasoningEffort | undefined,
        reasoningMaxTokens: opts.reasoningMaxTokens,
        cacheSystem: Boolean(opts.cacheSystem),
      };

      // ── REPL mode ──────────────────────────────────────────────────────────
      if (opts.interactive) {
        await runChatRepl(
          { input: process.stdin, promptOut: process.stderr, replyOut: process.stdout },
          async (history) => {
            const req = buildChatRequest(history, model, chatOpts);
            const res = await client.request<ChatCompletion>(ENDPOINTS.chat, req);
            return res?.choices?.[0]?.message?.content ?? "";
          },
          opts.system,
        );
        return;
      }

      // ── Single-turn mode ───────────────────────────────────────────────────
      let prompt = promptArg;

      // Read from stdin if no positional arg and stdin is not a TTY
      if (!prompt && !process.stdin.isTTY) {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        prompt = Buffer.concat(chunks).toString("utf8").trim();
      }

      if (!prompt) {
        throw new OctenValidationError("no prompt provided");
      }

      const messages: ChatMessage[] = [];
      if (opts.system) messages.push({ role: "system", content: opts.system });
      messages.push({ role: "user", content: prompt });

      const req = buildChatRequest(messages, model, chatOpts);

      // --json forces the non-stream path: we emit one JSON object, not a token stream.
      if (mode === "json" || opts.stream === false) {
        const res = await client.request<ChatCompletion>(ENDPOINTS.chat, req);
        emit(res, mode, renderChat);
        return;
      }

      // Streaming pretty mode. The new protocol emits typed chunks
      // (search_done / content / finish / usage) terminated by [DONE].
      const httpRes = await client.stream(ENDPOINTS.chat, req);
      let noted = false;
      let reasoningNoted = false;
      const sources: Array<{ title?: string; url?: string }> = [];
      for await (const ev of parseSSE(httpRes)) {
        const e = ev as StreamEvent;
        if (e.type === "search_done") {
          if (!noted) {
            process.stderr.write("(web search complete)\n");
            noted = true;
          }
          // Collect cited sources to list after the answer.
          for (const grp of ((e as any).search_results ?? []) as Array<{ results?: Array<{ title?: string; url?: string }> }>)
            for (const r of grp.results ?? []) sources.push({ title: r.title, url: r.url });
          continue;
        }
        // Reasoning trace streams to stderr (keeps stdout = answer only).
        const reasoning: string | undefined = e.choices?.[0]?.delta?.reasoning;
        if (reasoning) {
          if (!reasoningNoted) {
            process.stderr.write(pc.dim("reasoning: "));
            reasoningNoted = true;
          }
          process.stderr.write(pc.dim(reasoning));
        }
        const piece: string | undefined = e.choices?.[0]?.delta?.content;
        if (piece) process.stdout.write(piece);
      }
      if (reasoningNoted) process.stderr.write("\n");
      process.stdout.write("\n");
      if (sources.length) {
        process.stderr.write(pc.dim("Sources:\n"));
        sources.forEach((s, i) =>
          process.stderr.write(pc.dim(`  [${i + 1}] ${s.title ?? ""} ${s.url ?? ""}\n`)),
        );
      }
    });
}
