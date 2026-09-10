export class OctenError extends Error {}
export class OctenAuthError extends OctenError {}
/**
 * There is no credential at all — no flag, no env var, no credentials file.
 *
 * A subclass rather than a flag so that every existing `instanceof
 * OctenAuthError` keeps matching, while the two callers that must tell "you
 * have nothing" apart from "you have something that doesn't apply here"
 * (`configure-mcp`, `configure-skills --set-key`) can do it without matching on
 * message text. Both used to treat any OctenAuthError as "no credential", so a
 * working credential plus an OCTEN_AUTH_ISSUER override produced "no API key
 * found", a `${OCTEN_API_KEY}` placeholder config, exit 0 — and, in
 * configure-skills, advice to run `octen login`, which cannot fix an
 * OCTEN_AUTH_* override.
 */
export class OctenNoCredentialError extends OctenAuthError {}
export class OctenValidationError extends OctenError {}
export class OctenTimeoutError extends OctenError {}
export class OctenNetworkError extends OctenError {}
/** A stream that was malformed, truncated, or carried a typed error event. */
export class OctenStreamError extends OctenError {}
export class OctenAPIError extends OctenError {
  constructor(message: string, public status: number, public body?: unknown) { super(message); }
}

/** Keys that, when they hold a non-empty string, are the error message. */
const MESSAGE_KEYS = ["msg", "message", "detail"] as const;

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/**
 * Pull a human-readable message out of an error payload.
 *
 * Fixed order: `msg` -> `message` -> `detail`, then recurse into `error`, then
 * the caller's fallback. Only a non-empty string is ever returned, so a nested
 * object can no longer reach the terminal as "[object Object]". Visited nodes
 * are tracked so a self-referential payload cannot loop.
 */
export function errorMessage(payload: unknown, fallback: string): string {
  const seen = new Set<object>();
  const walk = (node: unknown): string | undefined => {
    const direct = nonEmptyString(node);
    if (direct) return direct;
    if (node === null || typeof node !== "object") return undefined;
    if (seen.has(node)) return undefined;
    seen.add(node);
    const obj = node as Record<string, unknown>;
    for (const key of MESSAGE_KEYS) {
      const found = nonEmptyString(obj[key]);
      if (found) return found;
    }
    return walk(obj.error);
  };
  return walk(payload) ?? fallback;
}

export function exitCodeFor(err: unknown): number {
  if (err instanceof OctenAuthError || err instanceof OctenValidationError) return 2;
  return 1;
}
