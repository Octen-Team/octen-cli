import pc from "picocolors";
import type { SearchResultGroup } from "../../api/search.js";
import { formatResultList } from "./search.js";

export function renderBroadSearch(data: any): string {
  // Same envelope as /search: { data: { query, queries, search_results }, code, msg, ... }.
  const inner = (data as any)?.data;
  const body: any =
    data && typeof data === "object" && inner && typeof inner === "object" && !Array.isArray(inner)
      ? inner
      : data;

  const groups: SearchResultGroup[] = body?.search_results ?? [];

  if (!groups.length) {
    const code = (data as any)?.code;
    const msg = (data as any)?.msg;
    if (code != null && code !== 0 && msg) {
      return pc.red(`error: ${msg}`);
    }
    return pc.dim("No results.");
  }

  return groups
    .map((g) => {
      const header = pc.bold(`# ${g.query ?? "(sub-query)"}`);
      const results = g.results ?? [];
      const listing = results.length ? formatResultList(results) : pc.dim("   No results.");
      return `${header}\n\n${listing}`;
    })
    .join("\n\n");
}
