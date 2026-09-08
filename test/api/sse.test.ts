import { describe, it, expect } from "vitest";
import { parseSSE } from "../../src/api/sse.js";
import { OctenStreamError } from "../../src/api/errors.js";

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

/** A response whose body we can feed, close and observe cancellation on. */
function controlledResponse() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
    cancel() {
      cancelled = true;
    },
  });
  const response = new Response(body);
  return {
    response,
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
    wasCancelled: () => cancelled,
  };
}

const DONE = "data: [DONE]\n\n";
const FINISH = 'data: {"type":"finish"}\n\n';

async function collect(res: Response): Promise<any[]> {
  const out: any[] = [];
  for await (const ev of parseSSE(res)) out.push(ev);
  return out;
}

describe("parseSSE", () => {
  it("yields two parsed objects and stops at [DONE]", async () => {
    const collected = await collect(
      makeSSEResponse([
        'data: {"choices":[{"delta":{"content":"He"}}]}\n\n' +
          'data: {"choices":[{"delta":{"content":"llo"}}]}\n\n' +
          DONE,
      ]),
    );

    expect(collected).toHaveLength(2);
    expect(collected[0]).toMatchObject({ choices: [{ delta: { content: "He" } }] });
    expect(collected[1]).toMatchObject({ choices: [{ delta: { content: "llo" } }] });
  });

  it("handles events split across multiple chunks", async () => {
    const collected = await collect(
      makeSSEResponse(['data: {"choices":[{"delta":{"content":"Hi"}}]}\n', "\n" + DONE]),
    );

    expect(collected).toHaveLength(1);
    expect(collected[0]).toMatchObject({ choices: [{ delta: { content: "Hi" } }] });
  });

  it("handles an event split mid-JSON across two chunks", async () => {
    const collected = await collect(
      makeSSEResponse(['data: {"choices":[{"delta":{"cont', 'ent":"X"}}]}\n\n' + DONE]),
    );
    expect(collected).toHaveLength(1);
    expect(collected[0].choices[0].delta.content).toBe("X");
  });

  it("skips comment/keepalive lines without throwing", async () => {
    const collected = await collect(
      makeSSEResponse([": keepalive\n\n" + 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n' + DONE]),
    );

    expect(collected).toHaveLength(1);
    expect(collected[0].choices[0].delta.content).toBe("ok");
  });

  it("flushes a final complete data event that lacks its trailing blank line", async () => {
    const res = makeSSEResponse([
      'data: {"choices":[{"delta":{"content":"A"}}]}\n\n' + 'data: {"type":"finish"}',
    ]);
    const collected = await collect(res);

    expect(collected).toHaveLength(2);
    expect(collected[0].choices[0].delta.content).toBe("A");
    expect(collected[1]).toMatchObject({ type: "finish" });
  });

  it("stops cleanly on a trailing [DONE] with no trailing newline", async () => {
    const collected = await collect(
      makeSSEResponse(['data: {"choices":[{"delta":{"content":"A"}}]}\n\n' + "data: [DONE]"]),
    );

    expect(collected).toHaveLength(1);
    expect(collected[0].choices[0].delta.content).toBe("A");
  });
});

describe("parseSSE event framing", () => {
  it("accepts data: with no space and CRLF separators, without waiting for EOF", async () => {
    const feed = controlledResponse();
    feed.push('data:{"type":"content"}\r\n\r\n');

    const iterator = parseSSE(feed.response);
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({ type: "content" });

    await iterator.return(undefined);
  });

  it("joins multiple data lines in one event and parses them once", async () => {
    const collected = await collect(
      makeSSEResponse(['data: {"type":\ndata: "content"}\n\n' + DONE]),
    );

    expect(collected).toEqual([{ type: "content" }]);
  });

  it("raises OctenStreamError on malformed JSON instead of skipping it", async () => {
    await expect(collect(makeSSEResponse(["data: {bad}\n\n" + DONE]))).rejects.toThrow(
      OctenStreamError,
    );
  });

  it("raises OctenStreamError on a malformed trailing event at EOF", async () => {
    await expect(
      collect(
        makeSSEResponse(['data: {"choices":[{"delta":{"content":"A"}}]}\n\n' + "data: {invalid json"]),
      ),
    ).rejects.toThrow(OctenStreamError);
  });

  it("ignores data after [DONE]", async () => {
    const collected = await collect(
      makeSSEResponse([DONE + 'data: {"type":"content"}\n\n']),
    );
    expect(collected).toEqual([]);
  });

  it("still yields a usage event that arrives after finish", async () => {
    const collected = await collect(
      makeSSEResponse([FINISH + 'data: {"type":"usage","usage":{"total_tokens":3}}\n\n' + DONE]),
    );
    expect(collected).toHaveLength(2);
    expect(collected[1]).toMatchObject({ type: "usage" });
  });
});

describe("parseSSE completion contract", () => {
  it("rejects when the stream ends after content with no terminator", async () => {
    const iterator = parseSSE(
      makeSSEResponse(['data: {"type":"content","choices":[{"delta":{"content":"A"}}]}\n\n']),
    );

    const first = await iterator.next();
    expect(first.value).toMatchObject({ type: "content" });
    await expect(iterator.next()).rejects.toThrow(OctenStreamError);
  });

  it("rejects when the stream carries only a keepalive and then ends", async () => {
    await expect(collect(makeSSEResponse([":ping\n\n"]))).rejects.toThrow(OctenStreamError);
  });

  it("accepts a typed finish event followed by EOF", async () => {
    const collected = await collect(makeSSEResponse([FINISH]));
    expect(collected).toEqual([{ type: "finish" }]);
  });

  it("accepts an OpenAI-style finish_reason followed by EOF", async () => {
    const collected = await collect(
      makeSSEResponse(['data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n']),
    );
    expect(collected).toHaveLength(1);
  });

  it("accepts an empty stream that closes with [DONE] only", async () => {
    expect(await collect(makeSSEResponse([DONE]))).toEqual([]);
  });
});

describe("parseSSE reader cleanup", () => {
  it("cancels the source and releases the reader when the consumer stops early", async () => {
    const feed = controlledResponse();
    feed.push('data: {"type":"content"}\n\n');

    const iterator = parseSSE(feed.response);
    await iterator.next();
    await iterator.return(undefined);

    expect(feed.wasCancelled()).toBe(true);
    expect(feed.response.body!.locked).toBe(false);
  });

  it("releases the reader after a normal [DONE] completion", async () => {
    const res = makeSSEResponse(['data: {"type":"content"}\n\n' + DONE]);
    await collect(res);
    expect(res.body!.locked).toBe(false);
  });

  it("releases the reader after a truncation error", async () => {
    const res = makeSSEResponse(['data: {"type":"content"}\n\n']);
    await expect(collect(res)).rejects.toThrow(OctenStreamError);
    expect(res.body!.locked).toBe(false);
  });

  it("releases the reader after a malformed-event error", async () => {
    const res = makeSSEResponse(["data: {bad}\n\n"]);
    await expect(collect(res)).rejects.toThrow(OctenStreamError);
    expect(res.body!.locked).toBe(false);
  });
});
