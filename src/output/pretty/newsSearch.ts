import pc from "picocolors";
import { formatResultList } from "./search.js";
import { envelopeError, unwrap } from "./envelope.js";

const MAX_SUMMARY = 400;

/**
 * News results print the storylines first, then the ranked articles.
 *
 * The storylines are a clustering of the coverage, not a second retrieval, and
 * they carry the summary that answers "what happened with X" without reading
 * every article. One caveat the reader has to know: domain filters narrow the
 * ranked articles only and never reach `subjects`, so a source-restricted
 * question has to be answered from the articles below.
 */
export function renderNewsSearch(data: any): string {
  const body = unwrap(data);
  const subjects: any[] = body?.subjects ?? [];
  const results: any[] = body?.results ?? [];

  if (!subjects.length && !results.length) {
    const err = envelopeError(data);
    return err ? pc.red(`error: ${err}`) : pc.dim("No results.");
  }

  const blocks: string[] = [];
  if (subjects.length) blocks.push(subjects.map(formatSubject).join("\n\n"));
  if (results.length) {
    if (subjects.length) blocks.push(pc.bold("Articles"));
    blocks.push(formatResultList(results));
  }
  return blocks.join("\n\n");
}

function formatSubject(s: any, i: number): string {
  const lines: string[] = [];
  lines.push(`${pc.bold(`Storyline ${i + 1}: ${s?.name ?? "(unnamed)"}`)}`);

  const span = [s?.time_start, s?.time_latest].filter(Boolean).join(" → ");
  if (span) lines.push(`   ${pc.dim(span)}`);

  if (s?.summary) {
    const raw = String(s.summary);
    lines.push(`   ${raw.length > MAX_SUMMARY ? raw.slice(0, MAX_SUMMARY) + "…" : raw}`);
  }

  // `top_news` is the lead article; `sub_news` are the supporting ones. They
  // need not appear in `results` at all, so dropping them would lose coverage
  // the caller already paid for.
  const articles = [s?.top_news, ...(s?.sub_news ?? [])].filter(Boolean);
  for (const a of articles) {
    lines.push(`   • ${a?.title ?? "(no title)"}`);
    if (a?.url) lines.push(`     ${pc.dim(a.url)}`);
    lines.push(...articleContent(a, "     "));
  }
  return lines.join("\n");
}

/**
 * Whatever content a storyline article carries, indented under it.
 *
 * These are not duplicates of the ranked results: a storyline's articles need
 * not appear in `data.results` at all, so dropping their `summary`,
 * `highlight` and `full_content` discards content the caller enabled and was
 * billed for, with nowhere else to find it.
 */
function articleContent(a: any, indent: string): string[] {
  const out: string[] = [];
  for (const field of ["summary", "highlight", "full_content"] as const) {
    const raw = a?.[field];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const text = raw.length > MAX_SUMMARY ? raw.slice(0, MAX_SUMMARY) + "…" : raw;
    out.push(...text.split("\n").map((l: string) => `${indent}${l}`));
  }
  return out;
}
