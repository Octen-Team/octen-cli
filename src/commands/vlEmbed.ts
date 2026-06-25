import { readFileSync, existsSync } from "node:fs";
import { extname } from "node:path";
import type { Command } from "commander";
import { ENDPOINTS } from "../api/constants.js";
import { OctenValidationError } from "../api/errors.js";
import { parseContentTokens, buildVlEmbeddingRequest } from "../api/vlEmbedding.js";
import type { VLContent } from "../api/vlEmbedding.js";
import { chooseMode, emit } from "../output/render.js";
import { renderVlEmbedding } from "../output/pretty/vlEmbedding.js";
import { makeClient, parseIntOpt, parseFloatOpt } from "./utils.js";

/** Map common file extensions to MIME types for base64 data URIs. */
function mimeForExtension(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".mp4": return "video/mp4";
    case ".webm": return "video/webm";
    default: return "application/octet-stream";
  }
}

/**
 * Resolve a single image or video content item:
 * - If the value looks like a URL (http://, https://) or data URI, return as-is.
 * - Otherwise treat it as a local file path, read and convert to a base64 data URI.
 *
 * NOTE: It is currently unconfirmed whether the Octen /vl-embedding API accepts
 * base64 data URIs or only HTTPS URLs. The local-file path is implemented here
 * for ergonomics but should be validated against the API once confirmed.
 */
function resolveContentValue(value: string): string {
  if (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("data:")
  ) {
    return value;
  }

  // Local file path — read and encode as base64 data URI.
  if (!existsSync(value)) {
    throw new OctenValidationError(`file not found: ${value}`);
  }
  const buf = readFileSync(value);
  const ext = extname(value);
  const mime = mimeForExtension(ext);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/** Resolve local file paths for image and video contents. */
function resolveLocalFiles(contents: VLContent[]): VLContent[] {
  return contents.map((c) => {
    if ("image" in c) {
      return { image: resolveContentValue(c.image) };
    }
    if ("video" in c) {
      return { video: resolveContentValue(c.video) };
    }
    return c; // text items pass through
  });
}

export function registerVlEmbed(program: Command) {
  program
    .command("vl-embed")
    .argument("<content...>", "ordered content tokens: text:... image:... video:...")
    .description("Create multimodal embeddings")
    .option("-m, --model <id>", "model: base | large | full id")
    .option("--dimension <n>", "output vector dimension", parseIntOpt("--dimension"))
    .option("--fps <n>", "video frames per second to sample", parseFloatOpt("--fps"))
    .option("--instruct <s>", "task instruction for embedding")
    // Fusion tri-state (same pattern as embed's --truncation):
    //   --fusion  → opts.fusion = true
    //   --no-fusion → opts.fusion = false
    //   Neither → opts.fusion = undefined (omit enable_fusion from API body)
    .option("--fusion", "enable fusion embedding")
    .option("--no-fusion", "disable fusion embedding")
    .action(async (contentArgs: string[], opts: Record<string, any>, command: Command) => {
      const g = command.optsWithGlobals();

      // Parse content tokens
      const rawContents = parseContentTokens(contentArgs);

      // Resolve local files to base64 data URIs
      const contents = resolveLocalFiles(rawContents);

      // Fusion tri-state: only forward if explicitly set via CLI
      const fusionSource = command.getOptionValueSource("fusion");
      const fusion: boolean | undefined =
        fusionSource === "cli" ? (opts.fusion as boolean) : undefined;

      const client = makeClient(g);
      const req = buildVlEmbeddingRequest(contents, {
        model: opts.model,
        fusion,
        dimension: opts.dimension,
        fps: opts.fps,
        instruct: opts.instruct,
      });

      const res = await client.request(ENDPOINTS.vlEmbedding, req);
      emit(res, chooseMode(g, process.stdout.isTTY ?? false), renderVlEmbedding);
    });
}
