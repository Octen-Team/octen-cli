import { EMBEDDING_MODELS } from "./constants.js";
import { OctenValidationError } from "./errors.js";

/** A single embedding item. All fields optional — the server is untyped. */
export interface EmbeddingItem {
  embedding?: number[];
  vector?: number[];
}

/** Response shape for the /embedding endpoint. */
export interface EmbeddingResponse {
  model?: string;
  data?: EmbeddingItem[];
  embeddings?: (number[] | EmbeddingItem)[];
}

export interface EmbeddingOpts {
  model?: string;
  dimension?: number;
  inputType?: "query" | "document";
  truncation?: boolean;
}

export function buildEmbeddingRequest(
  input: string | string[],
  o: EmbeddingOpts,
): Record<string, unknown> {
  // Validate: empty string or empty array both count as no input
  if (input === "" || (Array.isArray(input) && input.length === 0)) {
    throw new OctenValidationError("input is required");
  }

  // Resolve model: map shortcut aliases (e.g. "4b" → "octen-embedding-4b");
  // full ids and unknown values pass through unchanged.
  const model = o.model != null ? (EMBEDDING_MODELS[o.model] ?? o.model) : undefined;

  // The /embedding endpoint requires `input` to be an array — a bare string
  // returns 400 "Invalid params" — so always send an array (single or batch).
  const req: Record<string, unknown> = { input: Array.isArray(input) ? input : [input] };

  // Use `put` for optional fields that are null/undefined when absent.
  const put = (k: string, v: unknown) => {
    if (v != null) req[k] = v;
  };

  put("model", model);
  put("dimension", o.dimension);
  put("input_type", o.inputType);

  // truncation is tri-state: forward an explicit true/false, omit when undefined.
  if (o.truncation !== undefined) {
    req["truncation"] = o.truncation;
  }

  return req;
}
