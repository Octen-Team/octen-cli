import pc from "picocolors";
import { formatResultList } from "./search.js";
import { envelopeError, unwrap } from "./envelope.js";

/**
 * Give a lite-mode URL its scheme back.
 *
 * `lite` returns `github.com/docs`, not `https://github.com/docs`. A caller
 * piping that into a browser or another tool gets something nothing can fetch,
 * so the scheme goes on here rather than in a note the reader may not see.
 * Anything already carrying one is left alone, which covers `standard` and any
 * future mode.
 */
export function withScheme(url: unknown): unknown {
  if (typeof url !== "string" || url === "") return url;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url;
  // `//host/path` already has the slashes and wants only the scheme; adding
  // the pair as well would produce `https:////host/path`.
  return url.startsWith("//") ? `https:${url}` : `https://${url}`;
}

export function renderPulseSearch(data: any): string {
  const body = unwrap(data);
  const raw: any[] = body?.results ?? [];

  if (!raw.length) {
    const err = envelopeError(data);
    return err ? pc.red(`error: ${err}`) : pc.dim("No results.");
  }

  const results = raw.map((r) => (r && typeof r === "object" ? { ...r, url: withScheme(r.url) } : r));
  return formatResultList(results);
}
