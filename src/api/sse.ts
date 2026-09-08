import { OctenStreamError } from "./errors.js";

/** Prefix of an SSE data field. The single space after the colon is optional. */
const DATA_PREFIX = "data:";
const DONE_SENTINEL = "[DONE]";

/** True when an event says generation is over: typed `finish` or an OpenAI finish_reason. */
function isTerminalEvent(event: unknown): boolean {
  if (event === null || typeof event !== "object") return false;
  const obj = event as Record<string, unknown>;
  if (obj.type === "finish") return true;
  const choices = obj.choices;
  if (Array.isArray(choices)) {
    return choices.some(
      (choice) =>
        choice !== null &&
        typeof choice === "object" &&
        (choice as Record<string, unknown>).finish_reason != null,
    );
  }
  return false;
}

/**
 * Parse a Server-Sent Events stream from a fetch Response into parsed JSON events.
 *
 * Framing follows the SSE rules the chat endpoint actually uses: events are
 * separated by a blank line, LF and CRLF both terminate a line, `data:` may or
 * may not be followed by a space, and every `data:` line in one event is joined
 * with "\n" and parsed once — so a JSON object split across data lines survives.
 *
 * Completion is explicit. `[DONE]` is authoritative and nothing after it is
 * read; a typed `finish` event or an OpenAI-style `finish_reason` followed by
 * EOF also counts as complete. A stream that just stops is a truncation error
 * rather than a silently short answer. Malformed JSON is an error too, for the
 * same reason: a dropped event is indistinguishable from a shorter answer.
 *
 * The reader is always released, and the source is cancelled whenever iteration
 * stops before the body is drained — including when the consumer breaks early.
 */
export async function* parseSSE(res: Response): AsyncGenerator<unknown> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let pendingCR = false;
  let sawDone = false;
  let sawFinish = false;
  let sourceDrained = false;

  /** Normalize line endings, holding back a CR that may be half of a split CRLF. */
  const feed = (text: string): string => {
    let chunk = pendingCR ? `\r${text}` : text;
    pendingCR = chunk.endsWith("\r");
    if (pendingCR) chunk = chunk.slice(0, -1);
    return chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  };

  /** Parse one event block. Returns the event, or undefined for comment-only blocks. */
  const parseEvent = (block: string): { event?: unknown; done?: boolean } => {
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue;
      if (!line.startsWith(DATA_PREFIX)) continue;
      let value = line.slice(DATA_PREFIX.length);
      if (value.startsWith(" ")) value = value.slice(1);
      dataLines.push(value);
    }
    if (dataLines.length === 0) return {};

    const payload = dataLines.join("\n");
    if (payload.trim() === DONE_SENTINEL) return { done: true };
    if (payload.trim() === "") return {};

    try {
      return { event: JSON.parse(payload) };
    } catch {
      throw new OctenStreamError(
        `stream returned a malformed event: ${payload.slice(0, 200)}`,
      );
    }
  };

  try {
    while (!sawDone) {
      const { done, value } = await reader.read();
      if (done) {
        sourceDrained = true;
        buffer += feed(decoder.decode());
      } else {
        buffer += feed(decoder.decode(value, { stream: true }));
      }

      const blocks = buffer.split("\n\n");
      // The trailing segment may be an incomplete event; at EOF there is no more
      // data coming, so it is complete by definition and gets dispatched too.
      buffer = sourceDrained ? "" : (blocks.pop() ?? "");
      if (sourceDrained && blocks.length > 0 && blocks[blocks.length - 1].trim() === "") {
        blocks.pop();
      }

      for (const block of blocks) {
        const { event, done: isDone } = parseEvent(block);
        if (isDone) {
          sawDone = true;
          break;
        }
        if (event === undefined) continue;
        if (isTerminalEvent(event)) sawFinish = true;
        yield event;
      }

      if (sourceDrained) break;
    }

    if (!sawDone && !sawFinish) {
      throw new OctenStreamError(
        "stream ended before the response was complete (no [DONE] or finish event)",
      );
    }
  } finally {
    // Cancel unless the body was read to its end, so an early stop (consumer
    // break, [DONE], or an error) actually releases the connection. Cleanup
    // failures must not replace the error that got us here.
    if (!sourceDrained) {
      try {
        await reader.cancel();
      } catch {
        /* the stream is already gone */
      }
    }
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}
