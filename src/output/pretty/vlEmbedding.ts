import pc from "picocolors";

/**
 * Render an Octen /vl-embedding response in a compact table.
 *
 * Response shape is handled robustly:
 *   - item list at data.data ?? data.embeddings ?? data.items ?? []
 *   - each item's vector at item.embedding ?? item.vector ?? item (bare array)
 *   - item type label at item.type (e.g. "fusion" | "vl") when present
 *   - model from data.model
 *
 * Raw float arrays are never printed — use --json for those.
 */
export function renderVlEmbedding(data: any): string {
  const items: unknown[] =
    (data?.data ?? data?.embeddings ?? data?.items ?? []) as unknown[];

  if (!items.length) {
    return pc.dim("No embeddings returned.");
  }

  const model: string | undefined = data?.model;
  const modelLabel = model ? pc.dim(` (${model})`) : "";

  const lines: string[] = [];

  // Header
  lines.push(pc.bold(`VL Embeddings${modelLabel}`));

  // Column header
  lines.push(pc.dim("  #    dims   type"));
  lines.push(pc.dim("  ───────────────────"));

  // Rows
  items.forEach((item, i) => {
    // Resolve actual vector
    const vec: unknown[] = Array.isArray(item)
      ? item
      : Array.isArray((item as any)?.embedding)
        ? (item as any).embedding
        : Array.isArray((item as any)?.vector)
          ? (item as any).vector
          : [];

    const dims = vec.length;
    const typeLabel: string = (item as any)?.type ?? "";
    const idx = String(i + 1).padStart(3);
    const dimsStr = String(dims).padStart(6);
    const typePart = typeLabel ? `   ${typeLabel}` : "";
    lines.push(`  ${idx}  ${dimsStr}${typePart}`);
  });

  // Footer hint
  lines.push("");
  lines.push(pc.dim("  use --json for raw vectors"));

  return lines.join("\n");
}
