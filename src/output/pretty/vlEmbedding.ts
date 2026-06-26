import pc from "picocolors";

/**
 * Render an Octen /vl-embedding response in a compact table.
 *
 * The Octen API wraps the payload in an envelope: { data: { results }, code, msg, ... }.
 * We unwrap to the inner body when present, then handle the shape robustly:
 *   - item list at body.results ?? body.data ?? body.embeddings ?? body.items ?? []
 *   - each item's vector at item.embedding ?? item.vector ?? item (bare array)
 *   - item type label at item.type (e.g. "fusion" | "vl") when present
 *   - model from body.model ?? data.model
 *
 * Raw float arrays are never printed — use --json for those.
 */
export function renderVlEmbedding(data: any): string {
  // Unwrap the envelope only when `data.data` is a non-array object (the real
  // API shape). When `data.data` is itself an array (legacy un-enveloped shape),
  // keep `data` as-is so the `?? data` fallback paths below still work.
  const inner = (data as any)?.data;
  const body: any =
    data && typeof data === "object" && inner && typeof inner === "object" && !Array.isArray(inner)
      ? inner
      : data;

  const items: unknown[] =
    (body?.results ?? body?.data ?? body?.embeddings ?? body?.items ?? []) as unknown[];

  if (!items.length) {
    return pc.dim("No embeddings returned.");
  }

  const model: string | undefined = body?.model ?? (data as any)?.model;
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
