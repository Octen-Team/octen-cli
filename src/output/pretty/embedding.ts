import pc from "picocolors";

/**
 * Render an OpenAI-style /embedding response in a compact table.
 *
 * The Octen API wraps the payload in an envelope: { data: { results }, code, msg, ... }.
 * We unwrap to the inner body when present, then handle the shape robustly:
 *   - vectors at body.results ?? body.data ?? body.embeddings ?? []
 *   - each item's vector at item.embedding ?? item.vector ?? item (item may itself be the array)
 *   - model at body.model ?? data.model
 *
 * Raw float arrays are never printed in pretty mode.
 */
export function renderEmbedding(data: any): string {
  // Unwrap the envelope only when `data.data` is a non-array object (the real
  // API shape). When `data.data` is itself an array (legacy un-enveloped shape),
  // keep `data` as-is so the `?? data` fallback paths below still work.
  const inner = (data as any)?.data;
  const body: any =
    data && typeof data === "object" && inner && typeof inner === "object" && !Array.isArray(inner)
      ? inner
      : data;

  const items: unknown[] =
    (body?.results ?? body?.data ?? body?.embeddings ?? []) as unknown[];

  if (!items.length) {
    return pc.dim("No embeddings returned.");
  }

  const model: string | undefined = body?.model ?? (data as any)?.model;

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
