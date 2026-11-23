import pc from "picocolors";
import { quotePath } from "../../util/quotePath.js";
import { printable, printableLine } from "../../util/terminalText.js";
import { envelopeError, isRecord, unwrap } from "./envelope.js";
import { formatResultList } from "./search.js";

/** Where a description or a block of code is cut, as the other renderers cut a snippet. */
const MAX_TEXT = 300;
/** Where one line of design values is cut. */
const MAX_VALUE_LINE = 200;
/** The most images one call returns, so the most a group lookup can ask for. */
const MAX_COUNT = 100;
/**
 * How deep a design value is walked. Real ones are three or four levels deep;
 * the bound is there so one pathological value is cut short instead of
 * exhausting the stack and taking the whole listing down.
 */
const MAX_DEPTH = 12;

export interface DesignRenderContext {
  /** Set when the request was a group lookup, to the id that was asked for. */
  group?: string;
  /**
   * Set when the search was sent to a base URL given on the command line, so
   * the command printed for a follow-up lookup goes to the same place. A base
   * URL from the environment needs nothing: it carries over by itself.
   */
  baseUrl?: string;
}

/**
 * A string field, as one line that is safe to print. Everything this renderer
 * prints from the response goes through here or through `printable`: the text
 * is somebody else's page, and must not be able to drive the terminal.
 */
const text = (v: unknown): string => (typeof v === "string" ? printableLine(v).trim() : "");
const count = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/**
 * One line for a design value of any shape.
 *
 * The API says the fields vary by image, and they do: design tokens for a web
 * page, plain lists for a slide, counts for an app screen. So this walks
 * whatever it is given instead of naming fields. Three shapes are read down to
 * the value a person wants — a `$value` token wrapper, a colour carrying a
 * `hex`, a `{value, unit}` dimension — and anything else prints as `key value`
 * pairs, so a shape never seen before still reaches the terminal.
 */
function inline(v: unknown, depth = 0): { text: string; composite: boolean } {
  if (v == null) return { text: "", composite: false };
  if (depth >= MAX_DEPTH && typeof v === "object") return { text: "…", composite: false };
  if (typeof v !== "object") return { text: printableLine(String(v)), composite: false };
  if (Array.isArray(v)) {
    const parts = v.map((x) => inline(x, depth + 1).text).filter(Boolean);
    return { text: parts.join(", "), composite: parts.length > 1 };
  }
  const o = v as Record<string, unknown>;
  if ("$value" in o) return inline(o.$value, depth + 1);
  if (typeof o.hex === "string") {
    const alpha = count(o.alpha);
    const hex = text(o.hex);
    return { text: alpha != null && alpha !== 1 ? `${hex} (alpha ${alpha})` : hex, composite: false };
  }
  if (typeof o.unit === "string" && typeof o.value === "number")
    return { text: `${o.value}${text(o.unit)}`, composite: false };
  const parts = Object.entries(o)
    .map(([k, x]) => {
      const r = inline(x, depth + 1);
      return r.text ? `${printableLine(k)} ${r.composite ? `(${r.text})` : r.text}` : "";
    })
    .filter(Boolean);
  return { text: parts.join(", "), composite: parts.length > 0 };
}

/** Tracks whether anything was cut, so the note about `--json` is only printed when it applies. */
interface Shortened {
  any: boolean;
}

function cut(s: string, max: number, shortened: Shortened): string {
  if (s.length <= max) return s;
  shortened.any = true;
  // Not through the middle of a character that takes two code units: half of
  // one prints as a replacement mark.
  const end = /[\uD800-\uDBFF]/.test(s[max - 1]) ? max - 1 : max;
  return `${s.slice(0, end)}…`;
}

/** An id that prints unchanged: printable ASCII. Anything else is left to --json. */
const PASTEABLE_ID = /^[\x20-\x7e]+$/;

function groupNoun(type: unknown): string {
  return type === "deck" ? "deck" : type === "web_page" ? "page" : "group";
}

function formatImage(im: Record<string, any>, i: number, ctx: DesignRenderContext, shortened: Shortened): string {
  const lines: string[] = [];
  lines.push(`${i + 1}. ${pc.bold(text(im.title) || "(untitled)")}`);

  const width = count(im.width);
  const height = count(im.height);
  const kind = [text(im.type), width != null && height != null ? `${width}x${height}` : ""].filter(Boolean).join(" · ");
  if (kind) lines.push(`   ${pc.dim(kind)}`);
  if (text(im.url)) lines.push(`   ${pc.dim(text(im.url))}`);
  if (text(im.source_page)) lines.push(`   ${pc.dim(`Source: ${text(im.source_page)}`)}`);

  const group = isRecord(im.group) ? im.group : undefined;
  if (group) {
    const name = [text(group.name), text(group.type) ? `(${text(group.type)})` : ""].filter(Boolean).join(" ");
    const position = count(group.position);
    const total = count(group.total);
    const place = position != null && total != null ? `${position} of ${total}` : "";
    const where = [name, place].filter(Boolean).join(" — ");
    if (where) lines.push(`   ${where}`);

    // The id is only useful as the argument that fetches the rest, so it is
    // printed as that command. Skipped during a lookup: it is the command that
    // was just run.
    // Taken as sent, not through `text()`: the command is meant to be pasted,
    // so the id in it has to be the id the API returned. One that cannot be
    // shown unchanged — a control character, a tab, a line break — gets no
    // command, rather than one that looks up a different id.
    const id = typeof group.group_id === "string" ? group.group_id : "";
    if (id && !ctx.group) {
      const noun = groupNoun(group.type);
      if (!PASTEABLE_ID.test(id)) {
        lines.push(`   ${pc.dim(`The ${noun}'s group_id is in the --json output.`)}`);
      } else {
        const base = ctx.baseUrl ? ` --base-url ${quotePath(ctx.baseUrl)}` : "";
        const command = `octen design --group ${quotePath(id)}`;
        // One call returns at most MAX_COUNT, so for a larger group the
        // command fetches a part and is labelled as one; and with no total the
        // count is unknown, so it is neither given nor claimed.
        const hint = total == null || total < 1
          ? `More of the ${noun}: ${command} -n <count>${base} (returns 5 without -n)`
          : total > MAX_COUNT
            ? `First ${MAX_COUNT} of the ${noun}: ${command} -n ${MAX_COUNT}${base}`
            : `Whole ${noun}: ${command} -n ${total}${base}`;
        lines.push(`   ${pc.dim(hint)}`);
      }
    }

    const theme = isRecord(group.master) ? inline(group.master).text : "";
    if (theme) lines.push(`   ${pc.dim(`Deck theme: ${cut(theme, MAX_VALUE_LINE, shortened)}`)}`);
  }

  if (text(im.description)) lines.push(`   ${cut(text(im.description), MAX_TEXT, shortened)}`);

  if (isRecord(im.design_facts)) {
    const values = Object.entries(im.design_facts)
      .map(([k, v]) => [k, inline(v).text] as const)
      .filter(([, v]) => v);
    if (values.length) {
      lines.push(`   ${pc.bold("Design values")}`);
      for (const [k, v] of values) lines.push(`     ${printableLine(k)}: ${cut(v, MAX_VALUE_LINE, shortened)}`);
    }
  }

  const code = isRecord(im.snippet) && typeof im.snippet.code === "string" ? im.snippet.code : "";
  if (code) {
    const format = text(im.snippet.format);
    lines.push(`   ${pc.bold(`Code (${format ? `${format}, ` : ""}${code.length} chars)`)}`);
    // Each line indented, so a line of the code cannot read as a field.
    lines.push(...printable(cut(code, MAX_TEXT, shortened)).split("\n").map((l) => `     ${pc.dim(l)}`));
  }

  return lines.join("\n");
}

/**
 * The API returns five images of a group unless told otherwise, and a lookup
 * that shows part of a page reads as the whole of it. Says so when it applies.
 */
function groupRemainder(images: Array<Record<string, any>>): string | undefined {
  const total = images.map((im) => count(im.group?.total)).find((t) => t != null);
  if (total == null || images.length >= total) return undefined;
  const shown = `Showing ${images.length} of ${total} in this group`;
  if (images.length >= MAX_COUNT) return `${shown} — one call returns at most ${MAX_COUNT}.`;
  return total > MAX_COUNT
    ? `${shown} — add -n ${MAX_COUNT} for the first ${MAX_COUNT}, the most one call returns.`
    : `${shown} — add -n ${total} for all of them.`;
}

/**
 * Design references live under `data.images`; `data.results` holds the web
 * results that come back alongside.
 */
export function renderDesignSearch(data: any, ctx: DesignRenderContext = {}): string {
  const body = unwrap(data);
  // Entries that are not objects are skipped, so one of them cannot take the
  // entries beside it down with it.
  const images: Array<Record<string, any>> = Array.isArray(body?.images) ? body.images.filter(isRecord) : [];
  const web: Array<Record<string, any>> = Array.isArray(body?.results) ? body.results.filter(isRecord) : [];
  // An unknown group id is answered with an empty success, so "No results"
  // would hide the likeliest cause: the id.
  const noGroup = ctx.group && !images.length ? pc.dim(`No images in group ${printableLine(ctx.group)}.`) : undefined;

  if (!images.length && !web.length) {
    const err = envelopeError(data);
    if (err) return pc.red(`error: ${printableLine(err)}`);
    return noGroup ?? pc.dim("No results.");
  }

  const shortened: Shortened = { any: false };
  const blocks: string[] = [];
  if (images.length) blocks.push(images.map((im, i) => formatImage(im, i, ctx, shortened)).join("\n\n"));
  if (noGroup) blocks.push(noGroup);
  if (web.length) {
    if (blocks.length) blocks.push(pc.bold("Web results"));
    blocks.push(formatResultList(web));
  }

  const remainder = ctx.group ? groupRemainder(images) : undefined;
  if (remainder) blocks.push(pc.dim(remainder));
  if (shortened.any) blocks.push(pc.dim("Shortened for the terminal — --json prints the values and the code in full."));
  return blocks.join("\n\n");
}
