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
import { buildPremierSearchRequest } from "../../src/api/premierSearch.js";
import { buildDesignSearchRequest, type DesignImage } from "../../src/api/designSearch.js";
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
  "https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg";

const client = new OctenClient({
  apiKey: API_KEY ?? "missing",
  // Honours OCTEN_API_URL the same way the CLI itself does
  // (src/config/resolve.ts), so this matrix can be pointed at a non-production
  // environment. pre and prod share every hostname and are told apart only by
  // an `x-apt-env` request header, which this client cannot set — reaching pre
  // means pointing this at a local forwarder that adds it. Unset = production,
  // which is the historical behaviour.
  baseUrl: process.env.OCTEN_API_URL,
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

/**
 * POST a request, assert the envelope is a success, and hand back its `data`
 * so a test can check what came back, not only that something did.
 */
async function envelopeData(
  param: string,
  endpoint: string,
  req: Record<string, unknown>,
): Promise<{ images?: DesignImage[]; results?: Array<Record<string, unknown>> }> {
  let resp: EnvelopeResponse;
  try {
    resp = await client.request<EnvelopeResponse>(endpoint, req);
  } catch (e) {
    throw new Error(`[${param}] request failed -> ${describeError(e)}`);
  }
  expect(resp.code, `[${param}] code=${resp.code} msg=${resp.msg ?? "(none)"}`).toBe(0);
  expect(resp.data !== null && typeof resp.data === "object", `[${param}] no data object`).toBe(true);
  return resp.data as { images?: DesignImage[]; results?: Array<Record<string, unknown>> };
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

    for (const language of [["ja"], ["en", "zh"]] as const) {
      it(
        `search: language=[${language.join(",")}]`,
        async () => {
          const req = buildSearchRequest(BASE, { count: 3, language: [...language] });
          await expectEnvelopeOk(
            `search language=[${language.join(",")}]`,
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
  describe("extract", () => {
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

    for (const mode of ["standard", "advanced", "auto"] as const) {
      it(
        `fetch: mode=${mode}`,
        async () => {
          const req = buildExtractRequest(URLS, { mode, fetchTimeout: 60 });
          await expectEnvelopeOk(`fetch mode=${mode}`, ENDPOINTS.extract, req);
        },
        TEST_TIMEOUT_MS,
      );
    }

    it(
      "fetch: links (bare)",
      async () => {
        const req = buildExtractRequest(URLS, { links: true });
        await expectEnvelopeOk("fetch links", ENDPOINTS.extract, req);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "fetch: links=prefer_external max_links=5",
      async () => {
        const req = buildExtractRequest(URLS, { links: "prefer_external", maxLinks: 5 });
        await expectEnvelopeOk("fetch links=prefer_external", ENDPOINTS.extract, req);
      },
      TEST_TIMEOUT_MS,
    );

    // Response contract the pretty renderer relies on: resolved_mode on every
    // success, links as {url, anchor_text, is_external}, and billing counts in
    // top-level meta (not data.meta). Never asserts resolved_mode == requested.
    it(
      "fetch: mode=auto + links response contract",
      async () => {
        const req = buildExtractRequest(URLS, { mode: "auto", maxLinks: 5, fetchTimeout: 60 });
        const resp = await client.request<any>(ENDPOINTS.extract, req);
        expect(resp.code).toBe(0);
        const results = resp.data?.results ?? [];
        expect(results.length).toBe(1);
        for (const r of results.filter((x: any) => x.status === "success")) {
          expect(["standard", "advanced"]).toContain(r.resolved_mode);
          for (const l of r.links ?? []) {
            expect(typeof l.url).toBe("string");
            expect(typeof l.anchor_text).toBe("string");
            expect(typeof l.is_external).toBe("boolean");
          }
          expect((r.links ?? []).length).toBeLessThanOrEqual(5);
        }
        const byMode = resp.meta?.usage?.successful_by_mode;
        expect(typeof byMode?.standard_urls).toBe("number");
        expect(typeof byMode?.advanced_urls).toBe("number");
        expect(byMode.standard_urls + byMode.advanced_urls).toBe(resp.meta.usage.successful_urls);
        expect(resp.data?.meta).toBeUndefined();
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

    it(
      "chat: tools=[octen_search] (topic/time_range/language)",
      async () => {
        const req = buildChatRequest(MSG, CHAT_MODEL, {
          maxTokens: 200,
          search: { enabled: true, topic: "news", timeRange: "week", language: ["en"] },
        });
        await expectChatOk("chat tools=[octen_search]", req);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "chat: tools=[octen_broad_search] (max_queries=2)",
      async () => {
        const req = buildChatRequest(MSG, CHAT_MODEL, {
          maxTokens: 200,
          search: { broadEnabled: true, maxQueries: 2 },
        });
        await expectChatOk("chat tools=[octen_broad_search]", req);
      },
      TEST_TIMEOUT_MS,
    );

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

  // -------------------------------------------------------------------------
  // premier
  // -------------------------------------------------------------------------
  describe("premier", () => {
    const BASE = "OpenAI";

    it(
      "premier: base count=3 returns results",
      async () => {
        const req = buildPremierSearchRequest(BASE, { count: 3 });
        const data = await envelopeData("premier base count=3", ENDPOINTS.searchPremier, req);
        expect(data.results?.length, "premier returned no results").toBeGreaterThan(0);
      },
      TEST_TIMEOUT_MS,
    );

    for (const resultType of ["standard", "dynamic"] as const) {
      it(
        `premier: result_type=${resultType}`,
        async () => {
          const req = buildPremierSearchRequest(BASE, { count: 3, resultType });
          await expectEnvelopeOk(`premier result_type=${resultType}`, ENDPOINTS.searchPremier, req);
        },
        TEST_TIMEOUT_MS,
      );
    }

    it(
      "premier: the options it shares with search",
      async () => {
        const req = buildPremierSearchRequest(BASE, {
          count: 3,
          includeDomains: ["openai.com", "wikipedia.org"],
          excludeText: ["lawsuit"],
          language: ["en"],
          timeBasis: "published",
          timeRange: "year",
          format: "markdown",
          safesearch: "strict",
          highlight: true,
          highlightMaxTokens: 300,
          fullContent: true,
          fullContentMaxTokens: 500,
          images: true,
        });
        await expectEnvelopeOk("premier shared options", ENDPOINTS.searchPremier, req);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "premier: a highlight cap given on its own shortens the highlights",
      async () => {
        // One query, one domain, two calls that differ only in the cap: the
        // same pages come back, so each can be compared with itself.
        const QUERY = "PostgreSQL";
        const shared = { count: 5, includeDomains: ["en.wikipedia.org"] };
        const lengths = (data: { results?: Array<Record<string, unknown>> }) =>
          new Map((data.results ?? []).map((r) => [String(r.url), String(r.highlight ?? "").length]));

        const plain = lengths(await envelopeData("premier default highlights", ENDPOINTS.searchPremier, buildPremierSearchRequest(QUERY, shared)));
        const capped = lengths(await envelopeData("premier highlight cap", ENDPOINTS.searchPremier, buildPremierSearchRequest(QUERY, { ...shared, highlightMaxTokens: 100 })));

        // The same page in both calls, with a default highlight long enough
        // for the cap to bite. It must come back shorter, and not empty: a
        // `highlight` block the API read as switched off returns nothing.
        const long = [...plain].filter(([url, length]) => length >= 1000 && capped.has(url));
        expect(long.length, "no result with a 1000+ character highlight appears in both calls").toBeGreaterThan(0);
        for (const [url, length] of long) {
          expect(capped.get(url), `${url}: empty highlight under the cap`).toBeGreaterThan(0);
          expect(capped.get(url), `${url}: ${length} characters uncapped`).toBeLessThan(length);
        }
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "premier: start_time + end_time (bare dates)",
      async () => {
        const req = buildPremierSearchRequest(BASE, {
          count: 3,
          startTime: START_TIME.slice(0, 10),
          endTime: END_TIME.slice(0, 10),
        });
        await expectEnvelopeOk("premier start/end", ENDPOINTS.searchPremier, req);
      },
      TEST_TIMEOUT_MS,
    );
  });

  // -------------------------------------------------------------------------
  // design
  // -------------------------------------------------------------------------
  describe("design", () => {
    const BASE = "saas pricing page";

    it(
      "design: default returns design references and web results",
      async () => {
        const data = await envelopeData("design default", ENDPOINTS.designSearch, buildDesignSearchRequest(BASE, {}));
        expect(data.images?.length, "no design references").toBeGreaterThan(0);
        expect(data.results?.length, "no web results").toBeGreaterThan(0);
        expect(typeof data.images?.[0]?.url, "image has no url").toBe("string");
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "design: count=7",
      async () => {
        const data = await envelopeData("design count=7", ENDPOINTS.designSearch, buildDesignSearchRequest(BASE, { count: 7, noWeb: true }));
        expect(data.images?.length).toBe(7);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "design: --no-web returns no web results",
      async () => {
        const data = await envelopeData("design no-web", ENDPOINTS.designSearch, buildDesignSearchRequest(BASE, { noWeb: true }));
        expect(data.images?.length, "no design references").toBeGreaterThan(0);
        expect(data.results ?? []).toEqual([]);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "design: --no-images returns web results only",
      async () => {
        const data = await envelopeData("design no-images", ENDPOINTS.designSearch, buildDesignSearchRequest(BASE, { noImages: true, webCount: 3 }));
        expect(data.results?.length).toBe(3);
        expect(data.images ?? []).toEqual([]);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "design: --no-design-facts leaves the values out",
      async () => {
        const on = await envelopeData("design facts on", ENDPOINTS.designSearch, buildDesignSearchRequest(BASE, { noWeb: true }));
        // The control: without it, "no design_facts" would pass on a response
        // that never carries them.
        expect(on.images?.some((im) => im.design_facts != null), "control returned no design_facts").toBe(true);

        const off = await envelopeData("design facts off", ENDPOINTS.designSearch, buildDesignSearchRequest(BASE, { noWeb: true, noDesignFacts: true }));
        expect(off.images?.length, "no design references").toBeGreaterThan(0);
        expect(off.images?.filter((im) => im.design_facts != null)).toEqual([]);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "design: snippet on by default for page sections, off with --no-snippet, capped by --snippet-max-tokens",
      async () => {
        const QUERY = "landing page hero section";
        // A section is the same section in every call; its link is signed
        // anew each time, so it is keyed by where it sits in its page.
        const codeBySection = (images: DesignImage[] | undefined) =>
          new Map(
            (images ?? [])
              .filter((im) => im.group?.group_id && im.snippet?.code)
              .map((im) => [`${im.group!.group_id}#${im.group!.position}`, im.snippet!.code!.length]),
          );

        const on = await envelopeData("design snippet on", ENDPOINTS.designSearch, buildDesignSearchRequest(QUERY, { noWeb: true, count: 10 }));
        const full = codeBySection(on.images);
        expect(full.size, "control returned no code").toBeGreaterThan(0);

        const off = await envelopeData("design snippet off", ENDPOINTS.designSearch, buildDesignSearchRequest(QUERY, { noWeb: true, count: 10, noSnippet: true }));
        expect(off.images?.length, "no design references").toBeGreaterThan(0);
        expect((off.images ?? []).filter((im) => im.snippet != null)).toEqual([]);

        // The cap is checked on one page fetched twice by its group id: a
        // lookup returns the same sections in the same order every time, so
        // the comparison does not depend on two searches ranking alike.
        const page = (on.images ?? []).find(
          (im) => im.group?.group_id && (im.group.total ?? 0) <= 100 && (im.snippet?.code?.length ?? 0) >= 500,
        );
        expect(page, "search returned no section with 500+ characters of code").toBeTruthy();
        const { group_id: groupId, total } = page!.group!;
        const wholePage = async (label: string, extra: { snippetMaxTokens?: number }) =>
          codeBySection(
            (await envelopeData(label, ENDPOINTS.designSearch, buildDesignSearchRequest("", { group: groupId, count: total, noWeb: true, ...extra }))).images,
          );
        const uncapped = await wholePage("design snippet uncapped (group)", {});
        // The cap is the smallest the API takes. Only sections whose uncapped
        // code is well past it can show the cap working, and each of those
        // must come back strictly shorter — `<=` would pass on a cap the API
        // ignored.
        const capped = await wholePage("design snippet capped (group)", { snippetMaxTokens: 100 });
        const long = [...uncapped].filter(([, length]) => length >= 500);
        expect(long.length, "the page has no section with 500+ characters of code").toBeGreaterThan(0);
        for (const [key, length] of long) {
          expect(capped.get(key), `section ${key}: missing or empty under the cap`).toBeGreaterThan(0);
          expect(capped.get(key), `section ${key}: ${length} characters uncapped`).toBeLessThan(length);
        }
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "design: --group returns one deck in order, and needs no query",
      async () => {
        const found = await envelopeData("design slide search", ENDPOINTS.designSearch, buildDesignSearchRequest("startup pitch deck slide", { noWeb: true, count: 10 }));
        const grouped = (found.images ?? []).find((im) => im.group?.group_id && (im.group.total ?? 0) > 5 && (im.group.total ?? 0) <= 100);
        expect(grouped, "search returned no slide from a deck of 6 to 100 slides").toBeTruthy();
        const { group_id: groupId, total } = grouped!.group!;

        // The API returns five of a group unless told otherwise.
        const part = await envelopeData("design group default count", ENDPOINTS.designSearch, buildDesignSearchRequest("", { group: groupId, noWeb: true }));
        expect(part.images?.length).toBe(5);

        const whole = await envelopeData("design group whole", ENDPOINTS.designSearch, buildDesignSearchRequest("", { group: groupId, count: total, noWeb: true }));
        expect(whole.images?.length).toBe(total);
        expect(whole.images?.map((im) => im.group?.group_id)).toEqual(Array(total).fill(groupId));
        expect(whole.images?.map((im) => im.group?.position)).toEqual(Array.from({ length: total! }, (_, i) => i + 1));
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "design: an unknown --group is an empty success",
      async () => {
        const data = await envelopeData("design unknown group", ENDPOINTS.designSearch, buildDesignSearchRequest("", { group: "deck_0000000000000000000000000000000000000000000000000000000000000000" }));
        expect(data.images ?? []).toEqual([]);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "design: the web options",
      async () => {
        const req = buildDesignSearchRequest(BASE, {
          noImages: true,
          webCount: 3,
          includeDomains: ["stripe.com", "github.com", "notion.so"],
          language: ["en"],
          timeBasis: "crawled",
          timeRange: "year",
          highlightMaxTokens: 200,
          fullContent: true,
          fullContentMaxTokens: 500,
        });
        const data = await envelopeData("design web options", ENDPOINTS.designSearch, req);
        const hosts = (data.results ?? []).map((r) => new URL(String(r.url)).hostname);
        expect(hosts.length, "no web results to check the domain filter against").toBeGreaterThan(0);
        expect(hosts.filter((h) => !/(^|\.)(stripe\.com|github\.com|notion\.so)$/.test(h))).toEqual([]);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "design: a web highlight cap given on its own shortens the highlights",
      async () => {
        const lengths = (data: { results?: Array<Record<string, unknown>> }) =>
          new Map((data.results ?? []).map((r) => [String(r.url), String(r.highlight ?? "").length]));

        // One query, one domain, two calls that differ only in the cap.
        const QUERY = "Typography";
        const shared = { noImages: true, includeDomains: ["en.wikipedia.org"] };
        const plain = lengths(await envelopeData("design default highlights", ENDPOINTS.designSearch, buildDesignSearchRequest(QUERY, shared)));
        const capped = lengths(await envelopeData("design highlight cap", ENDPOINTS.designSearch, buildDesignSearchRequest(QUERY, { ...shared, highlightMaxTokens: 100 })));

        const long = [...plain].filter(([url, length]) => length >= 1000 && capped.has(url));
        expect(long.length, "no result with a 1000+ character highlight appears in both calls").toBeGreaterThan(0);
        for (const [url, length] of long) {
          expect(capped.get(url), `${url}: empty highlight under the cap`).toBeGreaterThan(0);
          expect(capped.get(url), `${url}: ${length} characters uncapped`).toBeLessThan(length);
        }
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "design: start_time + end_time (bare dates) and exclude_domains",
      async () => {
        const req = buildDesignSearchRequest(BASE, {
          noImages: true,
          excludeDomains: ["pinterest.com"],
          startTime: START_TIME.slice(0, 10),
          endTime: END_TIME.slice(0, 10),
        });
        await expectEnvelopeOk("design start/end + exclude_domains", ENDPOINTS.designSearch, req);
      },
      TEST_TIMEOUT_MS,
    );
  });
});
