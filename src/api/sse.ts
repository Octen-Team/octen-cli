/**
 * Parse a Server-Sent Events (SSE) stream from a fetch Response.
 * Yields parsed JSON objects from `data:` lines, stops at `data: [DONE]`.
 * Tolerates non-JSON keepalive/comment lines by skipping them.
 */
export async function* parseSSE(res: Response): AsyncGenerator<any> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE events are separated by double newlines
    const events = buffer.split("\n\n");
    // Keep the last (possibly incomplete) segment in the buffer
    buffer = events.pop() ?? "";

    for (const event of events) {
      // Gather data lines from the event block
      for (const line of event.split("\n")) {
        if (!line.startsWith("data:")) continue;

        const payload = line.slice("data:".length).trim();
        if (payload === "[DONE]") return;

        try {
          yield JSON.parse(payload);
        } catch {
          // Skip non-JSON keepalive or malformed lines
        }
      }
    }
  }

  // Flush any remaining buffer content
  if (buffer.trim()) {
    for (const line of buffer.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice("data:".length).trim();
      if (payload === "[DONE]") return;
      try {
        yield JSON.parse(payload);
      } catch {
        // skip
      }
    }
  }
}
