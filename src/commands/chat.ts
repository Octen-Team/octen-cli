import { createInterface } from "node:readline";
import type { Command } from "commander";
import { ENDPOINTS } from "../api/constants.js";
import { buildChatRequest, type ChatMessage, type ChatOpts, type ChatCompletion, type StreamEvent } from "../api/chat.js";
import { parseSSE } from "../api/sse.js";
import { OctenValidationError } from "../api/errors.js";
import { chooseMode, emit } from "../output/render.js";
import { renderChat } from "../output/pretty/chat.js";
import { makeClient, parseIntOpt, parseFloatOpt } from "./utils.js";

export function registerChat(program: Command) {
  program
    .command("chat")
    .argument("[prompt]", "prompt (or read stdin / use -i)")
    .description("Chat completion")
    .option("-m, --model <id>", "model ID")
    .option("--system <s>", "system message")
    .option("--web-search <onoff>", "on|off")
    .option("--temperature <n>", "sampling temperature", parseFloatOpt("--temperature"))
    .option("--top-p <n>", "nucleus sampling top-p", parseFloatOpt("--top-p"))
    .option("--frequency-penalty <n>", "frequency penalty", parseFloatOpt("--frequency-penalty"))
    .option("--presence-penalty <n>", "presence penalty", parseFloatOpt("--presence-penalty"))
    .option("--max-tokens <n>", "max output tokens", parseIntOpt("--max-tokens"))
    .option("--reasoning-effort <e>", "low|medium|high")
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
        webSearch: opts.webSearch as "on" | "off" | undefined,
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
        topP: opts.topP,
        frequencyPenalty: opts.frequencyPenalty,
        presencePenalty: opts.presencePenalty,
        stop: opts.stop,
        seed: opts.seed,
        reasoningEffort: opts.reasoningEffort as "low" | "medium" | "high" | undefined,
      };

      // ── REPL mode ──────────────────────────────────────────────────────────
      if (opts.interactive) {
        const history: ChatMessage[] = [];
        if (opts.system) history.push({ role: "system", content: opts.system });

        const rl = createInterface({ input: process.stdin, output: process.stderr, prompt: "> " });
        rl.prompt();

        rl.on("line", async (line: string) => {
          const trimmed = line.trim();
          if (trimmed === "/exit" || trimmed === "/quit") {
            rl.close();
            return;
          }
          if (trimmed === "/reset") {
            history.length = 0;
            if (opts.system) history.push({ role: "system", content: opts.system });
            process.stderr.write("(conversation reset)\n");
            rl.prompt();
            return;
          }
          if (!trimmed) { rl.prompt(); return; }

          history.push({ role: "user", content: trimmed });
          rl.pause();
          try {
            const req = buildChatRequest(history, model, chatOpts);
            const res = await client.request<ChatCompletion>(ENDPOINTS.chat, req);
            const reply: string = res?.choices?.[0]?.message?.content ?? "";
            history.push({ role: "assistant", content: reply });
            process.stdout.write(reply + "\n");
          } catch (err) {
            process.stderr.write(`error: ${(err as Error).message}\n`);
          } finally {
            rl.resume();
            rl.prompt();
          }
        });

        await new Promise<void>((resolve) => rl.on("close", resolve));
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

      // Streaming pretty mode
      const httpRes = await client.stream(ENDPOINTS.chat, req);
      for await (const ev of parseSSE(httpRes)) {
        const e = ev as StreamEvent;
        const piece: string | undefined = e.choices?.[0]?.delta?.content;
        if (piece) process.stdout.write(piece);
      }
      process.stdout.write("\n");
    });
}
