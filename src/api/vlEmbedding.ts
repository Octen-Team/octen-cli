import { VL_EMBEDDING_MODELS } from "./constants.js";
import { OctenValidationError } from "./errors.js";

// A single content item — exactly one of text, image, or video.
export type VLContent =
  | { text: string }
  | { image: string }
  | { video: string };

export interface VLEmbeddingOpts {
  model?: string;
  /** tri-state: true/false = explicit enable_fusion; undefined = omit from request */
  fusion?: boolean;
  dimension?: number;
  fps?: number;
  instruct?: string;
}

const ALLOWED_PREFIXES = new Set(["text", "image", "video"] as const);

/**
 * Parse ordered content tokens into VLContent objects.
 * Each token has the form "type:value" where the split occurs at the FIRST colon.
 * This means URLs (e.g. "image:https://x.com/a.png") are parsed correctly.
 */
export function parseContentTokens(tokens: string[]): VLContent[] {
  return tokens.map((tok) => {
    const colonIdx = tok.indexOf(":");
    if (colonIdx === -1) {
      throw new OctenValidationError(
        `invalid content token "${tok}": must start with text:, image:, or video:`,
      );
    }

    const prefix = tok.slice(0, colonIdx);
    const value = tok.slice(colonIdx + 1);

    if (!ALLOWED_PREFIXES.has(prefix as "text" | "image" | "video")) {
      throw new OctenValidationError(
        `invalid content token "${tok}": must start with text:, image:, or video:`,
      );
    }

    if (!value) {
      throw new OctenValidationError(
        `invalid content token "${tok}": must start with text:, image:, or video:`,
      );
    }

    return { [prefix]: value } as VLContent;
  });
}

/**
 * Build the request body for POST /vl-embedding.
 * Enforces content limits and resolves model aliases.
 */
export function buildVlEmbeddingRequest(
  contents: VLContent[],
  o: VLEmbeddingOpts,
): Record<string, unknown> {
  // --- Validate content limits ---
  if (contents.length === 0) {
    throw new OctenValidationError("contents must not be empty");
  }
  if (contents.length > 20) {
    throw new OctenValidationError("contents must not exceed 20 items total");
  }

  const imageCount = contents.filter((c) => "image" in c).length;
  if (imageCount > 5) {
    throw new OctenValidationError("contents must not include more than 5 images");
  }

  const videoCount = contents.filter((c) => "video" in c).length;
  if (videoCount > 1) {
    throw new OctenValidationError("contents must not include more than 1 video");
  }

  // --- Resolve model ---
  if (o.model === undefined || o.model === null) {
    throw new OctenValidationError("model is required (pass --model base|large)");
  }
  const model = VL_EMBEDDING_MODELS[o.model] ?? o.model;

  // --- Build body ---
  const req: Record<string, unknown> = {
    model,
    input: { contents },
  };

  const put = (k: string, v: unknown) => {
    if (v != null) req[k] = v;
  };

  // enable_fusion tri-state: only include when explicitly set (not undefined)
  if (o.fusion !== undefined) {
    req["enable_fusion"] = o.fusion;
  }

  put("dimension", o.dimension);
  put("fps", o.fps);
  put("instruct", o.instruct);

  return req;
}
