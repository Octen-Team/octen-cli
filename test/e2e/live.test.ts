/**
 * LIVE end-to-end parameter-coverage matrix for octen-cli.
 *
 * This file hits the REAL Octen API to surface request/response contract
 * mismatches that mocked unit tests cannot catch. It is GATED on
 * OCTEN_API_KEY — `describe.skipIf(!process.env.OCTEN_API_KEY)` — and is
 * EXCLUDED from the default `npm test` run (see vitest.config.ts /
 * vitest.e2e.config.ts). Run it with:
 *
 *   OCTEN_API_KEY=... npx vitest run test/e2e
 *
 * Every test builds its request THROUGH the production builders, POSTs via
 * the real OctenClient, and asserts the response indicates success. On
 * failure the assertion message includes the parameter under test plus the
 * API `msg`/error so the resulting matrix is human-readable.
 */
import { describe, it, expect } from "vitest";

import { OctenClient } from "../../src/api/client.js";
import { ENDPOINTS } from "../../src/api/constants.js";
import { buildSearchRequest } from "../../src/api/search.js";
import { buildExtractRequest } from "../../src/api/extract.js";
import { buildChatRequest } from "../../src/api/chat.js";
import { buildEmbeddingRequest } from "../../src/api/embedding.js";
import {
  buildVlEmbeddingRequest,
  parseContentTokens,
} from "../../src/api/vlEmbedding.js";

const API_KEY = process.env.OCTEN_API_KEY;

// Generous timeouts: extract / embedding / vl-embedding calls can take well
// over a minute on a cold cache.
const CLIENT_TIMEOUT_MS = 180_000;
const TEST_TIMEOUT_MS = 200_000;

// Known-good models per the task brief.
const CHAT_MODEL = "anthropic/claude-haiku-4.5";
const CHAT_MODEL_FALLBACK = "openai/gpt-5.4";

// A small image URL for VL embedding image content.
const IMAGE_URL =
  "https://upload.wikimedia.org/wikipedia/commons/3/36/SD_Card.jpg";

const client = new OctenClient({
  apiKey: API_KEY ?? "missing",
  timeoutMs: CLIENT_TIMEOUT_MS,
  // The contract bugs we hunt for are 4xx "Invalid params" responses; those
  // are NOT retryable, so retries only cost time on transient 5xx. Keep one
  // retry to ride out the occasional 5xx blip without inflating runtime.
  maxRetries: 1,
});

type EnvelopeResponse = {
  data?: unknown;
  code?: number;
  msg?: string;
  error?: unknown;
};

type ChatResponse = {
  choices?: unknown[];
};

/** Extract the API-provided message from a thrown error or response body. */
function describeError(e: unknown): string {
  if (e && typeof e === "object") {
    const anyE = e as { message?: string; status?: number; body?: unknown };
    const bodyMsg =
      anyE.body && typeof anyE.body === "object"
        ? (anyE.body as { msg?: string; error?: string }).msg ??
          (anyE.body as { msg?: string; error?: string }).error
        : undefined;
    const status = anyE.status != null ? `HTTP ${anyE.status}: ` : "";
    return `${status}${bodyMsg ?? anyE.message ?? String(e)}`;
  }
  return String(e);
}

/**
 * POST a pre-built envelope-style request (search/extract/embed/vl-embed) and
 * assert success. PASS = `resp.data` is an object AND (`code === 0` OR
 * `code === undefined`) AND no top-level `error`. Any thrown OctenAPIError
 * (e.g. a 400 "Invalid params") is reported as a FAIL with the API message.
 */
async function expectEnvelopeOk(
  param: string,
  endpoint: string,
  req: Record<string, unknown>,
): Promise<void> {
  let resp: EnvelopeResponse;
  try {
    resp = await client.request<EnvelopeResponse>(endpoint, req);
  } catch (e) {
    throw new Error(`[${param}] request failed -> ${describeError(e)}`);
  }

  const hasData = resp != null && typeof resp.data === "object" && resp.data !== null;
  const codeOk = resp.code === 0 || resp.code === undefined;
  const hasError = resp != null && resp.error != null;

  const ok = hasData && codeOk && !hasError;
  expect(
    ok,
    `[${param}] expected success envelope but got -> code=${resp?.code} msg=${
      resp?.msg ?? "(none)"
    } hasData=${hasData} error=${JSON.stringify(resp?.error)}`,
  ).toBe(true);
}

/**
 * POST a pre-built chat request (OpenAI-compatible, no envelope) and assert
 * success. PASS = `resp.choices?.length`.
 */
async function expectChatOk(
  param: string,
  req: Record<string, unknown>,
): Promise<void> {
  let resp: ChatResponse;
  try {
    resp = await client.request<ChatResponse>(ENDPOINTS.chat, req);
  } catch (e) {
    throw new Error(`[${param}] chat request failed -> ${describeError(e)}`);
  }
  const ok = Array.isArray(resp?.choices) && resp.choices.length > 0;
  expect(
    ok,
    `[${param}] expected non-empty choices but got -> ${JSON.stringify(
      resp,
    ).slice(0, 300)}`,
  ).toBe(true);
}

// ISO timestamps for search start/end time coverage (last 30 days).
const NOW = new Date();
const THIRTY_DAYS_AGO = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
const START_TIME = THIRTY_DAYS_AGO.toISOString();
const END_TIME = NOW.toISOString();

describe.skipIf(!API_KEY)("LIVE Octen API parameter matrix", () => {
  // -------------------------------------------------------------------------
  // search
  // -------------------------------------------------------------------------
  describe("search", () => {
    const BASE = "OpenAI";

    it(
      "search: base count=3",
      async () => {
        const req = buildSearchRequest(BASE, { count: 3 });
        await expectEnvelopeOk("search base count=3", ENDPOINTS.search, req);
      },
      TEST_TIMEOUT_MS,
    );

    for (const topic of ["general", "news"] as const) {
      it(
        `search: topic=${topic}`,
        async () => {
          const req = buildSearchRequest(BASE, { count: 3, topic });
          await expectEnvelopeOk(
            `search topic=${topic}`,
            ENDPOINTS.search,
            req,
          );
        },
        TEST_TIMEOUT_MS,
      );
    }

    for (const timeRange of ["day", "week", "month", "year", "d", "w", "m", "y"]) {
      it(
        `search: time_range=${timeRange}`,
        async () => {
          const req = buildSearchRequest(BASE, { count: 3, timeRange });
          await expectEnvelopeOk(
            `search time_range=${timeRange}`,
            ENDPOINTS.search,
            req,
          );
        },
        TEST_TIMEOUT_MS,
      );
    }

    for (const timeBasis of ["auto", "published", "crawled"] as const) {
      it(
        `search: time_basis=${timeBasis}`,
        async () => {
          const req = buildSearchRequest(BASE, { count: 3, timeBasis });
          await expectEnvelopeOk(
            `search time_basis=${timeBasis}`,
            ENDPOINTS.search,
            req,
          );
        },
        TEST_TIMEOUT_MS,
      );
    }

    it(
      "search: include_domains",
      async () => {
        const req = buildSearchRequest(BASE, {
          count: 3,
          includeDomains: ["openai.com"],
        });
        await expectEnvelopeOk(
          "search include_domains=[openai.com]",
          ENDPOINTS.search,
          req,
        );
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "search: exclude_domains",
      async () => {
        const req = buildSearchRequest(BASE, {
          count: 3,
          excludeDomains: ["reddit.com"],
        });
        await expectEnvelopeOk(
          "search exclude_domains=[reddit.com]",
          ENDPOINTS.search,
          req,
        );
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "search: include_text",
      async () => {
        const req = buildSearchRequest(BASE, {
          count: 3,
          includeText: ["AI"],
        });
        await expectEnvelopeOk(
          "search include_text=[AI]",
          ENDPOINTS.search,
          req,
        );
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "search: exclude_text",
      async () => {
        const req = buildSearchRequest(BASE, {
          count: 3,
          excludeText: ["spam"],
        });
        await expectEnvelopeOk(
          "search exclude_text=[spam]",
          ENDPOINTS.search,
          req,
        );
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "search: start_time + end_time (ISO, last 30 days)",
      async () => {
        const req = buildSearchRequest(BASE, {
          count: 3,
          startTime: START_TIME,
          endTime: END_TIME,
        });
        await expectEnvelopeOk(
          "search start_time/end_time",
          ENDPOINTS.search,
          req,
        );
      },
      TEST_TIMEOUT_MS,
    );

    for (const format of ["text", "markdown"] as const) {
      it(
        `search: format=${format}`,
        async () => {
          const req = buildSearchRequest(BASE, { count: 3, format });
          await expectEnvelopeOk(
            `search format=${format}`,
            ENDPOINTS.search,
            req,
          );
        },
        TEST_TIMEOUT_MS,
      );
    }

    for (const safesearch of ["off", "strict"] as const) {
      it(
        `search: safesearch=${safesearch}`,
        async () => {
          const req = buildSearchRequest(BASE, { count: 3, safesearch });
          await expectEnvelopeOk(
            `search safesearch=${safesearch}`,
            ENDPOINTS.search,
            req,
          );
        },
        TEST_TIMEOUT_MS,
      );
    }

    it(
      "search: highlight=true (+max_tokens=300)",
      async () => {
        const req = buildSearchRequest(BASE, {
          count: 3,
          highlight: true,
          highlightMaxTokens: 300,
        });
        await expectEnvelopeOk(
          "search highlight=true",
          ENDPOINTS.search,
          req,
        );
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "search: full_content=true (+max_tokens=1000)",
      async () => {
        const req = buildSearchRequest(BASE, {
          count: 3,
          fullContent: true,
          fullContentMaxTokens: 1000,
        });
        await expectEnvelopeOk(
          "search full_content=true",
          ENDPOINTS.search,
          req,
        );
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "search: images=true",
      async () => {
        const req = buildSearchRequest(BASE, { count: 3, images: true });
        await expectEnvelopeOk("search images=true", ENDPOINTS.search, req);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "search: videos=true",
      async () => {
        const req = buildSearchRequest(BASE, { count: 3, videos: true });
        await expectEnvelopeOk("search videos=true", ENDPOINTS.search, req);
      },
      TEST_TIMEOUT_MS,
    );
  });

  // -------------------------------------------------------------------------
  // fetch / extract
  // -------------------------------------------------------------------------
  describe("fetch", () => {
    const URLS = ["https://example.com"];

    it(
      "fetch: query=domain",
      async () => {
        const req = buildExtractRequest(URLS, { query: "domain" });
        await expectEnvelopeOk("fetch query=domain", ENDPOINTS.extract, req);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "fetch: max_age=3600",
      async () => {
        const req = buildExtractRequest(URLS, { maxAge: 3600 });
        await expectEnvelopeOk("fetch max_age=3600", ENDPOINTS.extract, req);
      },
      TEST_TIMEOUT_MS,
    );

    for (const format of ["markdown", "text"] as const) {
      it(
        `fetch: format=${format}`,
        async () => {
          const req = buildExtractRequest(URLS, { format });
          await expectEnvelopeOk(
            `fetch format=${format}`,
            ENDPOINTS.extract,
            req,
          );
        },
        TEST_TIMEOUT_MS,
      );
    }

    it(
      "fetch: fetch_timeout=30",
      async () => {
        const req = buildExtractRequest(URLS, { fetchTimeout: 30 });
        await expectEnvelopeOk(
          "fetch fetch_timeout=30",
          ENDPOINTS.extract,
          req,
        );
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "fetch: images=true",
      async () => {
        const req = buildExtractRequest(URLS, { images: true });
        await expectEnvelopeOk("fetch images=true", ENDPOINTS.extract, req);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "fetch: videos=true",
      async () => {
        const req = buildExtractRequest(URLS, { videos: true });
        await expectEnvelopeOk("fetch videos=true", ENDPOINTS.extract, req);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "fetch: audio=true",
      async () => {
        const req = buildExtractRequest(URLS, { audio: true });
        await expectEnvelopeOk("fetch audio=true", ENDPOINTS.extract, req);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "fetch: favicon=true",
      async () => {
        const req = buildExtractRequest(URLS, { favicon: true });
        await expectEnvelopeOk("fetch favicon=true", ENDPOINTS.extract, req);
      },
      TEST_TIMEOUT_MS,
    );
  });

  // -------------------------------------------------------------------------
  // chat (non-stream)
  // -------------------------------------------------------------------------
  describe("chat", () => {
    const MSG = [{ role: "user" as const, content: "say hi" }];

    it(
      "chat: base say hi",
      async () => {
        // Resolve a known-good model up front; if claude-haiku is rejected we
        // note it and continue with the gpt fallback for the rest of the file.
        const req = buildChatRequest(MSG, CHAT_MODEL, { maxTokens: 50 });
        await expectChatOk("chat base", req);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "chat: system='be terse'",
      async () => {
        const msgs = [
          { role: "system" as const, content: "be terse" },
          { role: "user" as const, content: "say hi" },
        ];
        const req = buildChatRequest(msgs, CHAT_MODEL, { maxTokens: 50 });
        await expectChatOk("chat system", req);
      },
      TEST_TIMEOUT_MS,
    );

    for (const webSearch of ["on", "off"] as const) {
      it(
        `chat: web_search=${webSearch}`,
        async () => {
          const req = buildChatRequest(MSG, CHAT_MODEL, {
            maxTokens: 50,
            webSearch,
          });
          await expectChatOk(`chat web_search=${webSearch}`, req);
        },
        TEST_TIMEOUT_MS,
      );
    }

    it(
      "chat: temperature=0.5",
      async () => {
        const req = buildChatRequest(MSG, CHAT_MODEL, {
          maxTokens: 50,
          temperature: 0.5,
        });
        await expectChatOk("chat temperature=0.5", req);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "chat: top_p=0.9",
      async () => {
        const req = buildChatRequest(MSG, CHAT_MODEL, {
          maxTokens: 50,
          topP: 0.9,
        });
        await expectChatOk("chat top_p=0.9", req);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "chat: max_tokens=50",
      async () => {
        const req = buildChatRequest(MSG, CHAT_MODEL, { maxTokens: 50 });
        await expectChatOk("chat max_tokens=50", req);
      },
      TEST_TIMEOUT_MS,
    );

    for (const effort of ["low", "medium", "high"] as const) {
      it(
        `chat: reasoning_effort=${effort}`,
        async () => {
          const req = buildChatRequest(MSG, CHAT_MODEL, {
            maxTokens: 50,
            reasoningEffort: effort,
          });
          await expectChatOk(`chat reasoning_effort=${effort}`, req);
        },
        TEST_TIMEOUT_MS,
      );
    }

    it(
      "chat: stop=['END']",
      async () => {
        const req = buildChatRequest(MSG, CHAT_MODEL, {
          maxTokens: 50,
          stop: ["END"],
        });
        await expectChatOk("chat stop=['END']", req);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "chat: seed=42",
      async () => {
        const req = buildChatRequest(MSG, CHAT_MODEL, {
          maxTokens: 50,
          seed: 42,
        });
        await expectChatOk("chat seed=42", req);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "chat: frequency_penalty=0.1",
      async () => {
        const req = buildChatRequest(MSG, CHAT_MODEL, {
          maxTokens: 50,
          frequencyPenalty: 0.1,
        });
        await expectChatOk("chat frequency_penalty=0.1", req);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "chat: presence_penalty=0.1",
      async () => {
        const req = buildChatRequest(MSG, CHAT_MODEL, {
          maxTokens: 50,
          presencePenalty: 0.1,
        });
        await expectChatOk("chat presence_penalty=0.1", req);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      `chat: fallback model ${CHAT_MODEL_FALLBACK}`,
      async () => {
        const req = buildChatRequest(MSG, CHAT_MODEL_FALLBACK, {
          maxTokens: 50,
        });
        await expectChatOk(`chat model=${CHAT_MODEL_FALLBACK}`, req);
      },
      TEST_TIMEOUT_MS,
    );
  });

  // -------------------------------------------------------------------------
  // embed
  // -------------------------------------------------------------------------
  describe("embed", () => {
    const INPUT = ["hello world"];

    for (const model of ["0.6b", "4b", "8b"]) {
      it(
        `embed: model=${model}`,
        async () => {
          const req = buildEmbeddingRequest(INPUT, { model });
          await expectEnvelopeOk(
            `embed model=${model}`,
            ENDPOINTS.embedding,
            req,
          );
        },
        TEST_TIMEOUT_MS,
      );
    }

    it(
      "embed: dimension=512",
      async () => {
        const req = buildEmbeddingRequest(INPUT, {
          model: "4b",
          dimension: 512,
        });
        await expectEnvelopeOk(
          "embed dimension=512",
          ENDPOINTS.embedding,
          req,
        );
      },
      TEST_TIMEOUT_MS,
    );

    for (const inputType of ["query", "document"] as const) {
      it(
        `embed: input_type=${inputType}`,
        async () => {
          const req = buildEmbeddingRequest(INPUT, {
            model: "4b",
            inputType,
          });
          await expectEnvelopeOk(
            `embed input_type=${inputType}`,
            ENDPOINTS.embedding,
            req,
          );
        },
        TEST_TIMEOUT_MS,
      );
    }

    for (const truncation of [true, false]) {
      it(
        `embed: truncation=${truncation}`,
        async () => {
          const req = buildEmbeddingRequest(INPUT, {
            model: "4b",
            truncation,
          });
          await expectEnvelopeOk(
            `embed truncation=${truncation}`,
            ENDPOINTS.embedding,
            req,
          );
        },
        TEST_TIMEOUT_MS,
      );
    }
  });

  // -------------------------------------------------------------------------
  // vl-embed
  // -------------------------------------------------------------------------
  describe("vl-embed", () => {
    const TEXT_CONTENT = parseContentTokens(["text:a red car"]);
    const IMAGE_CONTENT = parseContentTokens([`image:${IMAGE_URL}`]);

    for (const model of ["base", "large"]) {
      it(
        `vl-embed: model=${model} (text content)`,
        async () => {
          const req = buildVlEmbeddingRequest(TEXT_CONTENT, { model });
          await expectEnvelopeOk(
            `vl-embed model=${model} text`,
            ENDPOINTS.vlEmbedding,
            req,
          );
        },
        TEST_TIMEOUT_MS,
      );
    }

    it(
      "vl-embed: image content (model=base)",
      async () => {
        const req = buildVlEmbeddingRequest(IMAGE_CONTENT, { model: "base" });
        await expectEnvelopeOk(
          "vl-embed image content",
          ENDPOINTS.vlEmbedding,
          req,
        );
      },
      TEST_TIMEOUT_MS,
    );

    for (const fusion of [true, false]) {
      it(
        `vl-embed: enable_fusion=${fusion}`,
        async () => {
          const req = buildVlEmbeddingRequest(TEXT_CONTENT, {
            model: "base",
            fusion,
          });
          await expectEnvelopeOk(
            `vl-embed enable_fusion=${fusion}`,
            ENDPOINTS.vlEmbedding,
            req,
          );
        },
        TEST_TIMEOUT_MS,
      );
    }

    it(
      "vl-embed: dimension=1024",
      async () => {
        const req = buildVlEmbeddingRequest(TEXT_CONTENT, {
          model: "base",
          dimension: 1024,
        });
        await expectEnvelopeOk(
          "vl-embed dimension=1024",
          ENDPOINTS.vlEmbedding,
          req,
        );
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "vl-embed: fps=1 (image content)",
      async () => {
        const req = buildVlEmbeddingRequest(IMAGE_CONTENT, {
          model: "base",
          fps: 1,
        });
        await expectEnvelopeOk(
          "vl-embed fps=1",
          ENDPOINTS.vlEmbedding,
          req,
        );
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "vl-embed: instruct='represent this'",
      async () => {
        const req = buildVlEmbeddingRequest(TEXT_CONTENT, {
          model: "base",
          instruct: "represent this",
        });
        await expectEnvelopeOk(
          "vl-embed instruct",
          ENDPOINTS.vlEmbedding,
          req,
        );
      },
      TEST_TIMEOUT_MS,
    );
  });
});
