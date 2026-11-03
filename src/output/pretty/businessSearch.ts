import pc from "picocolors";
import { formatResultList } from "./search.js";
import { envelopeError, unwrap } from "./envelope.js";

// Long series are capped: sixteen quarters of financials on one card is the
// opposite of what a structured answer is for. The count of what was left out
// is printed, so the reader knows the series continues.
const SERIES_SHOWN = 4;
const MAX_SUMMARY = 400;

/** `81615003648` → `81.6B`. Raw figures at this magnitude are unreadable. */
function money(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  const abs = Math.abs(n);
  for (const [limit, suffix] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]] as const) {
    if (abs >= limit) return `${(n / limit).toFixed(1)}${suffix}`;
  }
  return String(n);
}

/**
 * Business results print the entity cards first, then the ranked sources.
 *
 * The cards are the answer — a company's numbers, its people, what it just
 * announced — and the sources are the evidence behind them.
 */
export function renderBusinessSearch(data: any): string {
  const body = unwrap(data);
  const entities: any[] = body?.entities ?? [];
  const results: any[] = body?.results ?? [];

  if (!entities.length && !results.length) {
    const err = envelopeError(data);
    return err ? pc.red(`error: ${err}`) : pc.dim("No results.");
  }

  const blocks: string[] = [];
  if (entities.length) blocks.push(entities.map(formatEntity).join("\n\n"));
  if (results.length) {
    if (entities.length) blocks.push(pc.bold("Sources"));
    blocks.push(formatResultList(results));
  }
  return blocks.join("\n\n");
}

function formatEntity(e: any): string {
  const lines: string[] = [];
  const kind = e?.type ? ` ${pc.dim(`(${e.type})`)}` : "";
  lines.push(`${pc.bold(e?.name ?? "(unnamed)")}${kind}`);

  if (e?.summary) {
    const raw = String(e.summary);
    lines.push(`   ${raw.length > MAX_SUMMARY ? raw.slice(0, MAX_SUMMARY) + "…" : raw}`);
  }

  lines.push(...formatMetrics(e?.metrics));

  // A person entity carries its own role and history where a company carries
  // key_people. Rendering only the latter leaves a person card with no career
  // information at all.
  if (e?.current_position) lines.push(`   ${e.current_position}`);
  const career: any[] = e?.career ?? [];
  if (career.length) {
    lines.push(`   ${pc.bold("Career")}`);
    for (const c of career.slice(0, SERIES_SHOWN)) {
      const span = [c?.start, c?.end ?? "present"].filter(Boolean).join(" – ");
      const role = [c?.title, c?.organization].filter(Boolean).join(" at ");
      lines.push(`     ${role || "(role unknown)"}${span ? ` ${pc.dim(`(${span})`)}` : ""}`);
    }
    if (career.length > SERIES_SHOWN) pushElided(lines, career.length - SERIES_SHOWN, "earlier roles");
  }

  const people: any[] = e?.key_people ?? [];
  if (people.length) {
    lines.push(`   ${pc.bold("Key people")}`);
    for (const p of people.slice(0, SERIES_SHOWN * 2)) {
      const role = [p?.title, p?.company].filter(Boolean).join(" at ");
      lines.push(`     ${p?.name ?? "(unnamed)"}${role ? ` — ${role}` : ""}`);
    }
  }

  // Requested through --max-activities, so dropping them silently makes that
  // flag do nothing the caller can see.
  const activities: any[] = e?.activities ?? [];
  if (activities.length) {
    lines.push(`   ${pc.bold("Activity")}`);
    for (const a of activities.slice(0, SERIES_SHOWN)) {
      lines.push(`     • ${a?.title ?? "(untitled)"}`);
      if (a?.time_published) lines.push(`       ${pc.dim(a.time_published)}`);
      if (a?.url) lines.push(`       ${pc.dim(a.url)}`);
      lines.push(...content(a, "       "));
    }
    if (activities.length > SERIES_SHOWN) pushElided(lines, activities.length - SERIES_SHOWN, "more");
  }

  const news: any[] = e?.news ?? [];
  if (news.length) {
    lines.push(`   ${pc.bold("Recent")}`);
    for (const n of news.slice(0, SERIES_SHOWN)) {
      lines.push(`     • ${n?.title ?? "(no title)"}`);
      if (n?.url) lines.push(`       ${pc.dim(n.url)}`);
      // The caller enabled --highlight for these too, and paid for them.
      lines.push(...content(n, "       "));
    }
  }
  return lines.join("\n");
}

function formatMetrics(m: any): string[] {
  if (!m || typeof m !== "object") return [];
  const out: string[] = [];

  const fin: any[] = Array.isArray(m.financials) ? m.financials : [];
  if (fin.length) {
    out.push(`   ${pc.bold("Financials")}`);
    for (const f of fin.slice(0, SERIES_SHOWN)) {
      const bits = [
        f?.revenue != null ? `revenue ${money(f.revenue)}` : "",
        f?.net_income != null ? `net income ${money(f.net_income)}` : "",
      ].filter(Boolean).join(", ");
      out.push(`     ${f?.period ?? "?"}${bits ? ` — ${bits}` : ""}`);
    }
    if (fin.length > SERIES_SHOWN) out.push(pc.dim(`     (+${fin.length - SERIES_SHOWN} earlier periods)`));
  }

  const fund: any[] = Array.isArray(m.funding) ? m.funding : [];
  if (fund.length) {
    out.push(`   ${pc.bold("Funding")}`);
    for (const f of fund.slice(0, SERIES_SHOWN)) {
      const led = f?.lead_investors ? ` — led by ${String(f.lead_investors).split(";").join(", ")}` : "";
      out.push(`     ${f?.date ?? "?"} ${f?.round ?? ""} ${money(f?.amount)}${led}`.replace(/\s+/g, " "));
    }
    if (fund.length > SERIES_SHOWN) out.push(pc.dim(`     (+${fund.length - SERIES_SHOWN} earlier rounds)`));
  }

  const s = m.stock;
  if (s && typeof s === "object") {
    const bits = [
      s.price != null ? `${s.price}${s.currency ? ` ${s.currency}` : ""}` : "",
      typeof s.todays_change_percent === "number" ? `${s.todays_change_percent.toFixed(2)}% today` : "",
    ].filter(Boolean).join(", ");
    if (bits) out.push(`   ${pc.bold("Stock")} ${bits}`);
  }
  return out;
}

/** `(+N more)`, so a truncated series says what was left out. */
function pushElided(lines: string[], n: number, label: string): void {
  lines.push(pc.dim(`     (+${n} ${label})`));
}

/** Whatever content an item carries — the caller asked for it. */
function content(item: any, indent: string): string[] {
  const res: string[] = [];
  for (const field of ["summary", "highlight", "full_content"] as const) {
    const raw = item?.[field];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const text = raw.length > MAX_SUMMARY ? raw.slice(0, MAX_SUMMARY) + "…" : raw;
    res.push(...text.split("\n").map((l: string) => `${indent}${l}`));
  }
  return res;
}
