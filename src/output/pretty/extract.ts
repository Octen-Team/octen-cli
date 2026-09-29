import pc from "picocolors";
import type { ExtractItem, ExtractLink, ExtractMeta } from "../../api/extract.js";

const MAX_CONTENT = 500;
/** Links and media lists are capped like content: first N entries unless --full. */
const MAX_LIST = 10;

/** A labelled, indented URL list, capped at MAX_LIST unless `full`. */
function formatList(label: string, entries: string[], full: boolean): string[] {
  if (!entries.length) return [];
  const shown = full ? entries : entries.slice(0, MAX_LIST);
  const lines = [pc.dim(`  ${label} (${entries.length}):`), ...shown.map((e) => `    ${e}`)];
  if (shown.length < entries.length)
    lines.push(pc.dim(`    … ${entries.length - shown.length} more (--full to show all)`));
  return lines;
}

function formatLink(l: ExtractLink): string {
  const anchor = l.anchor_text ? ` ${pc.dim(`— ${l.anchor_text}`)}` : "";
  const ext = l.is_external ? ` ${pc.dim("[external]")}` : "";
  return `${l.url ?? ""}${anchor}${ext}`;
}

const mediaUrls = (list?: { url?: string }[]): string[] =>
  (list ?? []).map((m) => m.url).filter((u): u is string => !!u);

/** Footer from the top-level `meta`: counts, billing by mode, and any warning. */
function formatFooter(meta: ExtractMeta | undefined): string | undefined {
  if (!meta || typeof meta !== "object") return undefined;
  const lines: string[] = [];
  const usage = meta.usage;
  const parts: string[] = [];
  if (usage?.total_urls != null)
    parts.push(`${usage.successful_urls ?? 0}/${usage.total_urls} successful`);
  const byMode = usage?.successful_by_mode;
  if (byMode)
    parts.push(`billed: ${byMode.standard_urls ?? 0} standard, ${byMode.advanced_urls ?? 0} advanced`);
  if (parts.length) lines.push(pc.dim(parts.join(" · ")));
  if (meta.warning) lines.push(pc.yellow(`warning: ${meta.warning}`));
  return lines.length ? lines.join("\n") : undefined;
}

/**
 * @param requestedMode the `--mode` the caller asked for, if any. Used only to
 * decide whether suggesting `--mode advanced` would be news to them.
 */
export function renderExtract(data: any, full = false, requestedMode?: string): string {
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

  const blocks = items
    .map((item) => {
      const lines: string[] = [];

      // Bold URL header
      lines.push(pc.bold(item.url));

      if (item.status === "failed") {
        lines.push(pc.red(`  failed: ${item.error_message ?? "(unknown error)"}`));
        // resolved_mode is absent on failure, so only the requested mode can rule it out.
        if (requestedMode !== "advanced") lines.push(pc.dim("  hint: retry with --mode advanced"));
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

        // The mode actually used — may differ from the requested one.
        if (item.resolved_mode) lines.push(pc.dim(`  mode: ${item.resolved_mode}`));

        // Media identity: favicon (default) + cover image (with --images)
        if (item.favicon) lines.push(pc.dim(`  favicon: ${item.favicon}`));
        if (item.cover_image?.url) lines.push(pc.dim(`  cover: ${item.cover_image.url}`));

        // Snippet: prefer joined highlights, else truncated full_content
        if (item.highlights && item.highlights.length > 0) {
          lines.push(`  ${item.highlights.join(" ")}`);
        } else if (item.full_content) {
          const raw = item.full_content;
          const snippet =
            !full && raw.length > MAX_CONTENT ? raw.slice(0, MAX_CONTENT) + "…" : raw;
          lines.push(`  ${snippet}`);
        }

        lines.push(...formatList("images", mediaUrls(item.images), full));
        lines.push(...formatList("videos", mediaUrls(item.videos), full));
        lines.push(...formatList("audio", mediaUrls(item.audio), full));
        lines.push(...formatList("links", (item.links ?? []).map(formatLink), full));

        // Standard can report "success" with only a page skeleton; advanced often recovers it.
        if (
          structPrimary === "No Main Content" &&
          item.resolved_mode !== "advanced" &&
          requestedMode !== "advanced"
        ) {
          lines.push(pc.dim("  hint: retry with --mode advanced"));
        }
      }

      return lines.join("\n");
    });

  // `meta` is top-level in the envelope (a sibling of `data`), not inside it.
  const footer = formatFooter((data as any)?.meta);
  if (footer) blocks.push(footer);
  return blocks.join("\n\n");
}
