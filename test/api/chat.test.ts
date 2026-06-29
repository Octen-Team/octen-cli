import { describe, it, expect } from "vitest";
import { buildChatRequest } from "../../src/api/chat.js";
import { OctenValidationError } from "../../src/api/errors.js";

describe("buildChatRequest", () => {
  const msgs = [{ role: "user" as const, content: "hello" }];

  it("throws if model is missing", () => {
    expect(() => buildChatRequest(msgs, undefined, {})).toThrow(OctenValidationError);
    expect(() => buildChatRequest(msgs, undefined, {})).toThrow(/model is required/);
  });

  it("throws if messages is empty", () => {
    expect(() => buildChatRequest([], "gpt-4", {})).toThrow(OctenValidationError);
    expect(() => buildChatRequest([], "gpt-4", {})).toThrow(/messages/i);
  });

  it("maps reasoningEffort -> reasoning.effort", () => {
    const req = buildChatRequest(msgs, "gpt-4", { reasoningEffort: "high" });
    expect(req).toMatchObject({ reasoning: { effort: "high" } });
  });

  it("accepts the expanded reasoning effort values", () => {
    for (const effort of ["xhigh", "high", "medium", "low", "minimal", "none"] as const) {
      const req = buildChatRequest(msgs, "gpt-4", { reasoningEffort: effort });
      expect(req).toMatchObject({ reasoning: { effort } });
    }
  });

  it("rejects an invalid reasoning effort", () => {
    expect(() => buildChatRequest(msgs, "gpt-4", { reasoningEffort: "turbo" as any })).toThrow(
      /--reasoning-effort/,
    );
  });

  it("supports reasoning max_tokens (alone and with effort)", () => {
    expect(buildChatRequest(msgs, "gpt-4", { reasoningMaxTokens: 2048 })).toMatchObject({
      reasoning: { max_tokens: 2048 },
    });
    expect(
      buildChatRequest(msgs, "gpt-4", { reasoningEffort: "low", reasoningMaxTokens: 100 }),
    ).toMatchObject({ reasoning: { effort: "low", max_tokens: 100 } });
  });

  it("includes only provided fields", () => {
    const req = buildChatRequest(msgs, "gpt-4", { temperature: 0.7 });
    expect(req).toMatchObject({ model: "gpt-4", temperature: 0.7 });
    expect(req).not.toHaveProperty("max_tokens");
    expect(req).not.toHaveProperty("top_p");
    expect(req).not.toHaveProperty("web_search");
    expect(req).not.toHaveProperty("tools");
    expect(req).not.toHaveProperty("reasoning");
  });

  it("never emits the legacy web_search param", () => {
    const req = buildChatRequest(msgs, "m", { search: { enabled: true } });
    expect(req).not.toHaveProperty("web_search");
    expect(req).not.toHaveProperty("web_search_options");
  });

  it("passes messages through unchanged", () => {
    const req = buildChatRequest(msgs, "gpt-4", {});
    expect(req.messages).toEqual(msgs);
  });

  it("maps all snake_case fields correctly", () => {
    const req = buildChatRequest(msgs, "m", {
      maxTokens: 512,
      maxCompletionTokens: 600,
      temperature: 0.5,
      topP: 0.9,
      topK: 40,
      minP: 0.05,
      topA: 0.8,
      repetitionPenalty: 1.1,
      frequencyPenalty: 0.1,
      presencePenalty: 0.2,
      stop: ["END"],
      seed: 42,
      verbosity: "high",
      reasoningEffort: "low",
    });
    expect(req).toMatchObject({
      model: "m",
      max_tokens: 512,
      max_completion_tokens: 600,
      temperature: 0.5,
      top_p: 0.9,
      top_k: 40,
      min_p: 0.05,
      top_a: 0.8,
      repetition_penalty: 1.1,
      frequency_penalty: 0.1,
      presence_penalty: 0.2,
      stop: ["END"],
      seed: 42,
      verbosity: "high",
      reasoning: { effort: "low" },
    });
    expect(req).not.toHaveProperty("web_search");
  });

  it("rejects an invalid verbosity", () => {
    expect(() => buildChatRequest(msgs, "m", { verbosity: "loud" as any })).toThrow(
      /--verbosity/,
    );
  });

  describe("web search (octen_search tool)", () => {
    it("does not add tools unless search is enabled", () => {
      expect(buildChatRequest(msgs, "m", {})).not.toHaveProperty("tools");
      expect(buildChatRequest(msgs, "m", { search: { enabled: false } })).not.toHaveProperty(
        "tools",
      );
    });

    it("builds an octen_search tool when search is enabled", () => {
      const req = buildChatRequest(msgs, "m", { search: { enabled: true } });
      expect(req.tools).toEqual([{ type: "octen_search", parameters: {} }]);
    });

    it("maps search sub-options into the tool parameters", () => {
      const req = buildChatRequest(msgs, "m", {
        search: {
          enabled: true,
          maxSearches: 3,
          count: 20,
          includeDomains: ["example.com"],
          excludeDomains: ["spam.com"],
          timeBasis: "published",
          startTime: "2024-01-01",
          endTime: "2024-12-31",
          format: "markdown",
          safesearch: "strict",
        },
      });
      expect(req.tools).toEqual([
        {
          type: "octen_search",
          parameters: {
            max_searches: 3,
            count: 20,
            include_domains: ["example.com"],
            exclude_domains: ["spam.com"],
            time_basis: "published",
            start_time: "2024-01-01",
            end_time: "2024-12-31",
            format: "markdown",
            safesearch: "strict",
          },
        },
      ]);
    });

    it("builds full_content and highlight blocks", () => {
      const req = buildChatRequest(msgs, "m", {
        search: {
          enabled: true,
          fullContent: true,
          fullContentMaxTokens: 4000,
          highlightMaxTokens: 256,
        },
      });
      const params = (req.tools as any)[0].parameters;
      expect(params.full_content).toEqual({ enable: true, max_tokens: 4000 });
      expect(params.highlight).toEqual({ enable: true, max_tokens: 256 });
    });

    it("validates search enums", () => {
      expect(() =>
        buildChatRequest(msgs, "m", { search: { enabled: true, timeBasis: "yesterday" as any } }),
      ).toThrow(/--search-time-basis/);
      expect(() =>
        buildChatRequest(msgs, "m", { search: { enabled: true, safesearch: "on" as any } }),
      ).toThrow(/--search-safesearch/);
      expect(() =>
        buildChatRequest(msgs, "m", { search: { enabled: true, format: "html" as any } }),
      ).toThrow(/--search-format/);
    });
  });

  describe("cache control", () => {
    const withSystem = [
      { role: "system" as const, content: "be terse" },
      { role: "user" as const, content: "hi" },
    ];

    it("leaves messages as plain strings without --cache-system", () => {
      const req = buildChatRequest(withSystem, "m", {});
      expect(req.messages).toEqual(withSystem);
    });

    it("wraps the system message in a cache_control content block", () => {
      const req = buildChatRequest(withSystem, "m", { cacheSystem: true });
      expect(req.messages).toEqual([
        {
          role: "system",
          content: [
            {
              type: "text",
              text: "be terse",
              cache_control: { type: "ephemeral", ttl: "5m" },
            },
          ],
        },
        { role: "user", content: "hi" },
      ]);
    });

    it("does nothing when there is no system message", () => {
      const req = buildChatRequest(msgs, "m", { cacheSystem: true });
      expect(req.messages).toEqual(msgs);
    });
  });
});
