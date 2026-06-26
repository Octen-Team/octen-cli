import pc from "picocolors";
import type { EmbeddingResponse } from "../../api/embedding.js";

/**
 * Render an OpenAI-style /embedding response in a compact table.
 * The response shape is handled robustly:
 *   - vectors at data.data ?? data.embeddings ?? []
 *   - each item's vector at item.embedding ?? item.vector ?? item (item may itself be the array)
 *   - model at data.model
 *
 * Raw float arrays are never printed in pretty mode.
 */
export function renderEmbedding(data: EmbeddingResponse): string {
  const items: unknown[] =
    (data?.data ?? data?.embeddings ?? []) as unknown[];

  if (!items.length) {
    return pc.dim("No embeddings returned.");
  }

  const model: string | undefined = data?.model;

  const lines: string[] = [];

  // Header
  const modelLabel = model ? pc.dim(` (${model})`) : "";
  lines.push(pc.bold(`Embeddings${modelLabel}`));

  // Column header
  lines.push(pc.dim("  #    dims"));
  lines.push(pc.dim("  ─────────"));

  // Rows
  items.forEach((item, i) => {
    // Resolve the actual vector from the item
    const vec: unknown[] = Array.isArray(item)
      ? item
      : Array.isArray((item as any)?.embedding)
        ? (item as any).embedding
        : Array.isArray((item as any)?.vector)
          ? (item as any).vector
          : [];

    const dims = vec.length;
    const idx = String(i + 1).padStart(3);
    const dimsStr = String(dims).padStart(6);
    lines.push(`  ${idx}  ${dimsStr}`);
  });

  // Footer hint: remind users to use --json for raw vectors
  lines.push("");
  lines.push(pc.dim("  use --json for raw vectors"));

  return lines.join("\n");
}
