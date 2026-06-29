import pc from "picocolors";
import type { VideoSearchResult } from "../../api/mediaSearch.js";

const MAX_SNIPPET = 300;

export function renderVideoSearch(data: any): string {
  // The Octen API wraps the payload in an envelope: { data: { results }, code, msg, ... }.
  // Unwrap to the inner body only when `data.data` is a non-array object (the real
  // API shape); fall back to the raw object otherwise so un-enveloped inputs still work.
  const inner = (data as any)?.data;
  const body: any =
    data && typeof data === "object" && inner && typeof inner === "object" && !Array.isArray(inner)
      ? inner
      : data;

  const res: VideoSearchResult[] = body?.results ?? [];

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

      // Duration in seconds
      if (r.duration_seconds != null) lines.push(`   ${pc.dim(`${r.duration_seconds}s`)}`);

      // Matched segment start–end
      const seg = r.match_segment;
      if (seg && (seg.start_seconds != null || seg.end_seconds != null)) {
        lines.push(`   ${pc.dim(`match ${seg.start_seconds ?? 0}–${seg.end_seconds ?? 0} s`)}`);
      }

      // Authors
      if (r.authors && r.authors.length) lines.push(`   ${pc.dim(r.authors.join(", "))}`);

      // Snippet from description (truncated)
      const raw = r.description ?? "";
      if (raw) {
        const snippet = raw.length > MAX_SNIPPET ? raw.slice(0, MAX_SNIPPET) + "…" : raw;
        lines.push(`   ${snippet}`);
      }

      return lines.join("\n");
    })
    .join("\n\n");
}
