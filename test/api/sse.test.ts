import { describe, it, expect } from "vitest";
import { parseSSE } from "../../src/api/sse.js";

function makeSSEResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream);
}

describe("parseSSE", () => {
  it("yields two parsed objects and stops at [DONE]", async () => {
    const body =
      'data: {"choices":[{"delta":{"content":"He"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"llo"}}]}\n\n' +
      "data: [DONE]\n\n";

    const res = makeSSEResponse([body]);
    const collected: any[] = [];
    for await (const ev of parseSSE(res)) {
      collected.push(ev);
    }

    expect(collected).toHaveLength(2);
    expect(collected[0]).toMatchObject({ choices: [{ delta: { content: "He" } }] });
    expect(collected[1]).toMatchObject({ choices: [{ delta: { content: "llo" } }] });
  });

  it("handles events split across multiple chunks", async () => {
    const part1 = 'data: {"choices":[{"delta":{"content":"Hi"}}]}\n';
    const part2 = "\ndata: [DONE]\n\n";

    const res = makeSSEResponse([part1, part2]);
    const collected: any[] = [];
    for await (const ev of parseSSE(res)) {
      collected.push(ev);
    }

    expect(collected).toHaveLength(1);
    expect(collected[0]).toMatchObject({ choices: [{ delta: { content: "Hi" } }] });
  });

  it("skips non-JSON keepalive lines without throwing", async () => {
    const body =
      ": keepalive\n\n" +
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n' +
      "data: [DONE]\n\n";

    const res = makeSSEResponse([body]);
    const collected: any[] = [];
    for await (const ev of parseSSE(res)) {
      collected.push(ev);
    }

    expect(collected).toHaveLength(1);
    expect(collected[0].choices[0].delta.content).toBe("ok");
  });

  it("returns immediately when stream has no data lines", async () => {
    const res = makeSSEResponse([":ping\n\n"]);
    const collected: any[] = [];
    for await (const ev of parseSSE(res)) {
      collected.push(ev);
    }
    expect(collected).toHaveLength(0);
  });

  it("handles an event split mid-JSON across two chunks", async () => {
    const res = makeSSEResponse([
      'data: {"choices":[{"delta":{"cont',
      'ent":"X"}}]}\n\ndata: [DONE]\n\n',
    ]);
    const collected: any[] = [];
    for await (const ev of parseSSE(res)) collected.push(ev);
    expect(collected).toHaveLength(1);
    expect(collected[0].choices[0].delta.content).toBe("X");
  });

  // --- trailing-buffer flush: stream ends without a trailing "\n\n" ---

  it("flushes a final complete data event with no trailing newline", async () => {
    // The last bytes are a complete `data: {...}` event but lack the trailing
    // "\n\n", so it never gets split out by the main loop and must be flushed
    // from the leftover buffer.
    const body =
      'data: {"choices":[{"delta":{"content":"A"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"B"}}]}';

    const res = makeSSEResponse([body]);
    const collected: any[] = [];
    for await (const ev of parseSSE(res)) collected.push(ev);

    expect(collected).toHaveLength(2);
    expect(collected[0].choices[0].delta.content).toBe("A");
    expect(collected[1].choices[0].delta.content).toBe("B");
  });

  it("stops cleanly on a trailing [DONE] with no trailing newline (no extra event)", async () => {
    const body =
      'data: {"choices":[{"delta":{"content":"A"}}]}\n\n' + "data: [DONE]";

    const res = makeSSEResponse([body]);
    const collected: any[] = [];
    for await (const ev of parseSSE(res)) collected.push(ev);

    // Only the first event is yielded; the trailing [DONE] in the leftover
    // buffer terminates the generator without adding an event.
    expect(collected).toHaveLength(1);
    expect(collected[0].choices[0].delta.content).toBe("A");
  });

  it("skips a trailing invalid-JSON data line with no trailing newline (no throw)", async () => {
    const body =
      'data: {"choices":[{"delta":{"content":"A"}}]}\n\n' + "data: {invalid json";

    const res = makeSSEResponse([body]);
    const collected: any[] = [];
    // Must not throw; the malformed leftover line is skipped.
    for await (const ev of parseSSE(res)) collected.push(ev);

    expect(collected).toHaveLength(1);
    expect(collected[0].choices[0].delta.content).toBe("A");
  });
});
