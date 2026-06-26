import { readFileSync, existsSync } from "node:fs";
import type { Command } from "commander";
import { ENDPOINTS } from "../api/constants.js";
import { buildEmbeddingRequest } from "../api/embedding.js";
import { OctenValidationError } from "../api/errors.js";
import { chooseMode, emit } from "../output/render.js";
import { renderEmbedding } from "../output/pretty/embedding.js";
import { makeClient, parseIntOpt } from "./utils.js";

export function registerEmbed(program: Command) {
  program
    .command("embed")
    .argument("[text...]", "text to embed (or use --file / stdin)")
    .description("Create text embeddings")
    .option("-m, --model <id>", "model: 0.6b | 4b | 8b or full id")
    .option("--dimension <n>", "output vector dimension", parseIntOpt("--dimension"))
    .option("--input-type <t>", "query | document")
    .option("--file <path>", "read texts from file (one per line)")
    // Truncation tri-state:
    //   --truncation sets opts.truncation = true
    //   --no-truncation sets opts.truncation = false
    //   Neither flag → opts.truncation = undefined (not passed to API)
    // We use getOptionValueSource("truncation") === "cli" to detect explicit CLI use.
    // Commander's --no-* mechanism: defining "--truncation" alone yields a tri-state when
    // getOptionValueSource is checked; "--no-truncation" negates it. No default is set, so
    // if neither is passed, the value stays undefined.
    .option("--truncation", "enable input truncation")
    .option("--no-truncation", "disable input truncation")
    .action(async (textArgs: string[], opts: Record<string, any>, command: Command) => {
      const g = command.optsWithGlobals();

      // --- Input resolution (precedence: args > --file > stdin) ---
      let input: string | string[];

      if (textArgs.length > 0) {
        // Single arg → string; multiple → array
        input = textArgs.length === 1 ? textArgs[0] : textArgs;
      } else if (opts.file) {
        if (!existsSync(opts.file)) throw new OctenValidationError(`file not found: ${opts.file}`);
        const raw = readFileSync(opts.file, "utf8");
        const lines = raw.split("\n").map((l: string) => l.trim()).filter(Boolean);
        input = lines.length === 1 ? lines[0] : lines;
      } else if (!process.stdin.isTTY) {
        // Read all of stdin and split into non-empty lines
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
        const raw = Buffer.concat(chunks).toString("utf8");
        const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
        input = lines.length === 1 ? lines[0] : lines;
      } else {
        throw new OctenValidationError("no input: provide text args, --file, or stdin");
      }

      // --- Truncation tri-state ---
      // If the user explicitly passed --truncation or --no-truncation, forward it.
      // Otherwise leave undefined so the API uses its own default.
      const truncationSource = command.getOptionValueSource("truncation");
      const truncation: boolean | undefined =
        truncationSource === "cli" ? (opts.truncation as boolean) : undefined;

      const client = makeClient(g);
      const req = buildEmbeddingRequest(input, {
        model: opts.model,
        dimension: opts.dimension,
        inputType: opts.inputType as "query" | "document" | undefined,
        truncation,
      });

      const res = await client.request(ENDPOINTS.embedding, req);
      emit(res, chooseMode(g, process.stdout.isTTY ?? false), renderEmbedding);
    });
}
