import pc from "picocolors";
import { printable, printableLine } from "../../util/terminalText.js";
import { isRecord } from "./envelope.js";

const MAX_SNIPPET = 300;

export function renderSearch(data: any): string {
  // The Octen API wraps the payload in an envelope: { data: { results }, code, msg, ... }.
  // Unwrap to the inner body only when `data.data` is a non-array object (the real
  // API shape); fall back to the raw object otherwise so un-enveloped inputs still work.
  const inner = (data as any)?.data;
  const body: any =
    data && typeof data === "object" && inner && typeof inner === "object" && !Array.isArray(inner)
      ? inner
      : data;

  // Entries that are not objects are dropped here, so a response made only of
  // them reads as no results rather than as an empty listing.
  const res: Array<Record<string, any>> = Array.isArray(body?.results) ? body.results.filter(isRecord) : [];

  if (!res.length) {
    // Surface app-level API errors (non-zero code) instead of a bland "No results."
    const code = (data as any)?.code;
    const msg = (data as any)?.msg;
    if (code != null && code !== 0 && msg) {
      return pc.red(`error: ${printableLine(String(msg))}`);
    }
    return pc.dim("No results.");
  }

  return formatResultList(res);
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Render a list of search results as numbered, titled blocks.
 *
 * Shared by every command that prints web results, so it takes whatever the
 * response held: an entry that is not an object is skipped rather than taking
 * the entries beside it down, a field of the wrong type is ignored, and the
 * text — which is somebody else's page — is made safe for a terminal.
 */
export function formatResultList(results: unknown): string {
  const list: Array<Record<string, any>> = Array.isArray(results) ? results.filter(isRecord) : [];
  return list
    .map((r, i) => {
      const lines: string[] = [];

      // Numbered + bold title
      const title = printableLine(str(r.title)) || "(no title)";
      lines.push(`${i + 1}. ${pc.bold(title)}`);

      // Dim URL
      const url = printableLine(str(r.url));
      if (url) lines.push(`   ${pc.dim(url)}`);

      // Dim publication time
      const published = printableLine(str(r.time_published));
      if (published) lines.push(`   ${pc.dim(published)}`);

      // Snippet from highlight or full_content (truncated)
      const raw = str(r.highlight) || str(r.full_content);
      if (raw) {
        const snippet = raw.length > MAX_SNIPPET ? raw.slice(0, MAX_SNIPPET) + "…" : raw;
        lines.push(`   ${printable(snippet)}`);
      }

      return lines.join("\n");
    })
    .join("\n\n");
}
