import pc from "picocolors";
import type { ImageSearchResult } from "../../api/mediaSearch.js";

const MAX_SNIPPET = 300;

export function renderImageSearch(data: any): string {
  // The Octen API wraps the payload in an envelope: { data: { results }, code, msg, ... }.
  // Unwrap to the inner body only when `data.data` is a non-array object (the real
  // API shape); fall back to the raw object otherwise so un-enveloped inputs still work.
  const inner = (data as any)?.data;
  const body: any =
    data && typeof data === "object" && inner && typeof inner === "object" && !Array.isArray(inner)
      ? inner
      : data;

  const res: ImageSearchResult[] = body?.results ?? [];

  if (!res.length) {
    // Surface app-level API errors (non-zero code) instead of a bland "No results."
    const code = (data as any)?.code;
    const msg = (data as any)?.msg;
    if (code != null && code !== 0 && msg) {
      return pc.red(`error: ${msg}`);
    }
    return pc.dim("No results.");
  }

  return res
    .map((r, i) => {
      const lines: string[] = [];

      // Numbered + bold title
      const title = r.title ?? "(no title)";
      lines.push(`${i + 1}. ${pc.bold(title)}`);

      // Dim URL
      if (r.url) lines.push(`   ${pc.dim(r.url)}`);

      // Dim source page
      if (r.source_page) lines.push(`   ${pc.dim(r.source_page)}`);

      // Dimensions WxH
      if (r.width != null && r.height != null) lines.push(`   ${pc.dim(`${r.width}x${r.height}`)}`);

      // Snippet from description or summary (truncated)
      const raw = r.description ?? r.summary ?? "";
      if (raw) {
        const snippet = raw.length > MAX_SNIPPET ? raw.slice(0, MAX_SNIPPET) + "…" : raw;
        lines.push(`   ${snippet}`);
      }

      return lines.join("\n");
    })
    .join("\n\n");
}
