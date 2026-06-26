import pc from "picocolors";
import type { SearchResponse, SearchResult } from "../../api/search.js";

const MAX_SNIPPET = 300;

export function renderSearch(data: SearchResponse): string {
  const res: SearchResult[] = data?.results ?? [];

  if (!res.length) return pc.dim("No results.");

  return res
    .map((r, i) => {
      const lines: string[] = [];

      // Numbered + bold title
      const title = r.title ?? "(no title)";
      lines.push(`${i + 1}. ${pc.bold(title)}`);

      // Dim URL
      if (r.url) lines.push(`   ${pc.dim(r.url)}`);

      // Dim publication time
      if (r.time_published) lines.push(`   ${pc.dim(r.time_published)}`);

      // Snippet from highlight or full_content (truncated)
      const raw = r.highlight ?? r.full_content ?? "";
      if (raw) {
        const snippet = raw.length > MAX_SNIPPET ? raw.slice(0, MAX_SNIPPET) + "…" : raw;
        lines.push(`   ${snippet}`);
      }

      return lines.join("\n");
    })
    .join("\n\n");
}
