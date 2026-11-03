import pc from "picocolors";
import { formatResultList } from "./search.js";
import { envelopeError, unwrap } from "./envelope.js";

/** `1.2 km` / `450 m` — metres are what the API returns, km is what reads past a point. */
function distance(m: unknown): string {
  if (typeof m !== "number" || !Number.isFinite(m)) return "";
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

/**
 * Place results live under `data.places`, not `data.results` — `results` is
 * where the optional web pages go, and reading the wrong one is an easy way to
 * conclude the endpoint returned nothing.
 */
export function renderPlaceSearch(data: any): string {
  const body = unwrap(data);
  const places: any[] = body?.places ?? [];
  const web: any[] = body?.results ?? [];

  if (!places.length && !web.length) {
    const err = envelopeError(data);
    return err ? pc.red(`error: ${err}`) : pc.dim("No results.");
  }

  const blocks: string[] = [];
  if (places.length) blocks.push(places.map(formatPlace).join("\n\n"));
  if (web.length) {
    if (places.length) blocks.push(pc.bold("Web results"));
    blocks.push(formatResultList(web));
  }
  return blocks.join("\n\n");
}

function formatPlace(p: any, i: number): string {
  const lines: string[] = [];
  lines.push(`${i + 1}. ${pc.bold(p?.name ?? "(unnamed)")}`);

  const sub = [p?.category, distance(p?.distance)].filter(Boolean).join(" · ");
  if (sub) lines.push(`   ${pc.dim(sub)}`);
  if (p?.address) lines.push(`   ${p.address}`);

  const rating = typeof p?.rating === "number"
    ? `${p.rating}/5${typeof p.review_count === "number" ? ` (${p.review_count} reviews)` : ""}`
    : "";
  const status = [rating, p?.status].filter(Boolean).join(" · ");
  if (status) lines.push(`   ${status}`);

  if (p?.phone) lines.push(`   ${pc.dim(`Phone: ${p.phone}`)}`);
  if (p?.website) lines.push(`   ${pc.dim(p.website)}`);

  const hours: string[] = Array.isArray(p?.opening_hours) ? p.opening_hours.filter(Boolean) : [];
  if (hours.length) lines.push(...hours.map((h) => `   ${pc.dim(h)}`));

  // Only present when `--max-reviews` asked for them, so nothing is printed
  // that was not requested — and nothing requested is dropped.
  const reviews: any[] = Array.isArray(p?.reviews) ? p.reviews.filter(Boolean) : [];
  if (reviews.length) {
    lines.push(`   ${pc.bold("Reviews")}`);
    for (const r of reviews) {
      const stamp = [
        typeof r?.rating === "number" ? `${r.rating}/5` : "",
        r?.time_published || "",
      ].filter(Boolean).join(" · ");
      if (stamp) lines.push(`     ${pc.dim(stamp)}`);
      const text = typeof r?.text === "string" ? r.text.trim() : "";
      // Each line indented, so a paragraph break cannot read as a new field.
      if (text) lines.push(...text.split("\n").map((l: string) => `     ${l}`));
    }
  }
  return lines.join("\n");
}
