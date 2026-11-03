/**
 * The Octen API wraps every payload in `{ code, msg, data, meta }`. Renderers
 * want the inner body, but have to cope with being handed an already-unwrapped
 * object (tests, piped JSON), so the unwrap is conditional.
 *
 * The seven renderers that predate this file each carry their own copy of the
 * same few lines. New ones use this instead; folding the old ones in is a
 * separate change, since each also has its own empty-state wording to preserve.
 */
export interface Envelope {
  code?: number;
  msg?: string;
  data?: unknown;
}

/** The inner body, or the input itself when it is not an envelope. */
export function unwrap(data: unknown): any {
  const inner = (data as any)?.data;
  return data && typeof data === "object" && inner && typeof inner === "object" && !Array.isArray(inner)
    ? inner
    : data;
}

/**
 * The API reports application errors inside a 200 envelope, so a renderer that
 * only checked for an empty list would print "No results" for an auth failure.
 * Returns the message to show, or undefined when the envelope is healthy.
 */
export function envelopeError(data: unknown): string | undefined {
  const code = (data as any)?.code;
  const msg = (data as any)?.msg;
  return code != null && code !== 0 && msg ? String(msg) : undefined;
}
