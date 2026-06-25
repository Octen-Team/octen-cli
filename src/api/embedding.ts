import { EMBEDDING_MODELS } from "./constants.js";
import { OctenValidationError } from "./errors.js";

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

  const req: Record<string, unknown> = { input };

  // Use `put` for optional fields that are null/undefined when absent.
  // For truncation we need a special check because `false` is a valid value
  // but `false != null` is true — so the standard put idiom correctly preserves it.
  const put = (k: string, v: unknown) => {
    if (v != null) req[k] = v;
  };

  put("model", model);
  put("dimension", o.dimension);
  put("input_type", o.inputType);

  // truncation: must preserve `false`, so check for undefined explicitly
  if (o.truncation !== undefined) {
    req["truncation"] = o.truncation;
  }

  return req;
}
