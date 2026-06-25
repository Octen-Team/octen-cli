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
});
