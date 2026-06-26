import pc from "picocolors";
import type { ExtractItem } from "../../api/extract.js";

const MAX_CONTENT = 500;

export function renderExtract(data: any): string {
  // The Octen API wraps the payload in an envelope: { data: { results }, code, msg, ... }.
  // Unwrap to the inner body only when `data.data` is a non-array object (the real
  // API shape); fall back to the raw object otherwise so un-enveloped inputs still work.
  const inner = (data as any)?.data;
  const body: any =
    data && typeof data === "object" && inner && typeof inner === "object" && !Array.isArray(inner)
      ? inner
      : data;

  const items: ExtractItem[] =
    body?.items ??
    body?.results ??
    [];

  if (!items.length) {
    // Surface app-level API errors (non-zero code) instead of a bland "No results."
    const code = (data as any)?.code;
    const msg = (data as any)?.msg;
    if (code != null && code !== 0 && msg) {
      return pc.red(`error: ${msg}`);
    }
    return pc.dim("No results.");
  }

  return items
    .map((item) => {
      const lines: string[] = [];

      // Bold URL header
      lines.push(pc.bold(item.url));

      if (item.status === "failed") {
        lines.push(pc.red(`  failed: ${item.error_message ?? "(unknown error)"}`));
      } else {
        // Dim metadata line: category / page_structure
        const catPrimary = item.category?.primary;
        const structPrimary = item.page_structure?.primary;
        if (catPrimary || structPrimary) {
          const parts = [catPrimary, structPrimary].filter(Boolean).join(" / ");
          lines.push(pc.dim(`  ${parts}`));
        }

        // Title
        if (item.title) lines.push(`  ${item.title}`);

        // Snippet: prefer joined highlights, else truncated full_content
        if (item.highlights && item.highlights.length > 0) {
          lines.push(`  ${item.highlights.join(" ")}`);
        } else if (item.full_content) {
          const raw = item.full_content;
          const snippet =
            raw.length > MAX_CONTENT ? raw.slice(0, MAX_CONTENT) + "…" : raw;
          lines.push(`  ${snippet}`);
        }
      }

      return lines.join("\n");
    })
    .join("\n\n");
}
